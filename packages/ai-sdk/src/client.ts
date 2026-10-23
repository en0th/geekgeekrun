import { agentProfile } from './builders.js';
import { ENDPOINTS } from './endpoints.js';
import type { EndpointName } from './endpoints.js';
import { AuthenticationError, BusinessError, HttpError, ProtocolError, ReauthenticationRequiredError, SessionChangedError } from './errors.js';
import { SseSession } from './sse.js';
import type { ApiResult, AuthAuthorization, AuthSessionProvider, Conversation, ChatMessage, DeliverySettingsInput, EndpointCallOptions, EndpointDefinition, HttpMethod, Id, JsonRecord, ProductWorkMode, ProxyMode, Query, RequestOptions, RetryRequest, StreamOptions, UserSayRequest, WorkSettings } from './types.js';

export type HeaderProvider = HeadersInit | (()=>HeadersInit|Promise<HeadersInit>);
export interface ClientOptions {
  /** Required; constructor and payload builders never start a request. */
  baseUrl: string;
  getAccessToken?: ()=>string|null|undefined|Promise<string|null|undefined>;
  auth?:AuthSessionProvider;
  headers?: HeaderProvider;
  credentials?: RequestCredentials;
  fetch?: typeof globalThis.fetch;
  /** External services are opt-in and never inherit API token/headers. */
  serviceBases?: Record<string,string>;
  serviceHeaders?: Record<string,HeaderProvider>;
}
export function serializeQuery(query: Query = {}): string {
  const result: string[] = [];
  for (const [name,value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && item !== undefined) result.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(item))}`);
    }
  }
  return result.join('&');
}
export function extractEnvelope(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return undefined;
  const object = raw as JsonRecord;
  if (object.data !== undefined && object.data !== null) return object.data;
  if (object.result !== undefined) return object.result;
  return undefined;
}
/** Observed wT transport filter: top level only; 0/false/arrays/nested null survive. */
export function cleanSsePayload(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  return Object.fromEntries(Object.entries(body).filter(([,value])=>value!==null&&value!==undefined&&value!==''));
}
function errorMessage(raw: unknown, fallback: string): string {
  if (raw && typeof raw === 'object') {
    const object = raw as JsonRecord;
    if (typeof object.msg === 'string' && object.msg) return object.msg;
    if (typeof object.message === 'string' && object.message) return object.message;
  }
  return fallback;
}
async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch {
    if (!response.ok) return text;
    throw new ProtocolError('Expected a JSON response');
  }
}
function checkResponse(response: Response, raw: unknown, checkBusiness = true, allowBusinessCodes: readonly number[] = []): void {
  const code = raw && typeof raw === 'object' ? (raw as JsonRecord).code : undefined;
  if (response.status === 401 || code === 401) throw new AuthenticationError(errorMessage(raw,'Authentication required'),response.status,raw,response.headers);
  if (!response.ok) throw new HttpError(errorMessage(raw,`HTTP ${response.status}`),response.status,raw,response.headers);
  if (checkBusiness && typeof code === 'number' && code !== 0 && code !== 200 && code !== 4 && !allowBusinessCodes.includes(code)) throw new BusinessError(errorMessage(raw,`Business error ${code}`),response.status,raw,response.headers,code);
}
function originBase(value: string): URL {
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError('HTTP(S) base URL without credentials/query/hash required');
  return url;
}

export class ZhijueAIClient {
  readonly #options: ClientOptions;
  readonly #fetch: typeof globalThis.fetch;
  readonly #base: URL;
  readonly #requestAuth=new WeakMap<Response,{authorization:AuthAuthorization;provider:AuthSessionProvider;managed:boolean}>();
  readonly #streams=new Map<SseSession,number>();
  #unsubscribeAuth:(()=>void)|undefined;
  #disposed=false;
  constructor(options: ClientOptions) {
    this.#options = options;
    this.#base = originBase(options.baseUrl);
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') throw new TypeError('A fetch implementation is required');
    if(options.auth&&options.getAccessToken)throw new TypeError('Use auth or getAccessToken, not both');
    this.#unsubscribeAuth=options.auth?.onSessionChange(epoch=>{
      for(const [stream,ownerEpoch]of this.#streams)if(ownerEpoch!==epoch)stream.abort(new SessionChangedError());
    });
  }
  #url(path: string, query: Query | undefined, service = 'api'): URL {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#') || path.includes('\\')) throw new TypeError('A relative absolute-path URL without query/hash is required');
    const base = service === 'api' ? this.#base : this.#options.serviceBases?.[service];
    if (!base) throw new TypeError(`Explicit serviceBases.${service} is required`);
    const url = new URL(path,typeof base === 'string' ? originBase(base) : base);
    url.search = serializeQuery(query);
    return url;
  }
  async #headers(extra: HeadersInit | undefined, service = 'api', mode:RequestOptions['auth']='auto', expectedEpoch?:number): Promise<{headers:Headers;authorization?:AuthAuthorization;provider?:AuthSessionProvider}> {
    const provider = service === 'api' ? this.#options.headers : this.#options.serviceHeaders?.[service];
    const headers = new Headers(typeof provider === 'function' ? await provider() : provider);
    if(mode==='none')headers.delete('authorization');
    new Headers(extra).forEach((value,key)=>headers.set(key,value));
    if(service==='api'&&mode!=='none'&&expectedEpoch!==undefined)this.#options.auth?.assertCurrent({sessionEpoch:expectedEpoch});
    let authorization:AuthAuthorization|undefined;
    const managed=service==='api'&&mode!=='none'&&!headers.get('authorization')?this.#options.auth:undefined;
    if(managed)authorization=await managed.authorize();
    if (service === 'api' && mode!=='none' && !headers.get('authorization')) {
      const token = managed?authorization?.accessToken:await this.#options.getAccessToken?.();
      if (token) headers.set('Authorization',`Bearer ${token}`);
    }
    if(mode==='required'&&!headers.get('authorization'))throw new ReauthenticationRequiredError('missing_session');
    return {headers,authorization,provider:managed};
  }
  async #request(method: HttpMethod, path: string, options: RequestOptions, service = 'api', streaming = false): Promise<Response> {
    if(this.#disposed)throw new TypeError('This client has been disposed');
    options.signal?.throwIfAborted();
    const sessionProvider=service==='api'&&options.auth!=='none'?this.#options.auth:undefined;
    const expectedEpoch=options.sessionEpoch??sessionProvider?.epoch;
    const {headers,authorization,provider}=await this.#headers(options.headers,service,options.auth,expectedEpoch);
    if(expectedEpoch!==undefined)sessionProvider?.assertCurrent({sessionEpoch:expectedEpoch});
    if(authorization)provider?.assertCurrent(authorization);
    if(this.#disposed)throw new TypeError('This client has been disposed');
    options.signal?.throwIfAborted();
    const init: RequestInit = {method,headers,credentials:service === 'api' ? (this.#options.credentials ?? 'include') : 'omit', signal:options.signal, cache:options.cache ?? 'no-store'};
    if (streaming) {
      if (!headers.has('accept')) headers.set('Accept','application/json,text/event-stream');
      if (!headers.has('x-requested-with')) headers.set('X-Requested-With','XMLHttpRequest');
    }
    if (options.body !== undefined) {
      if (method === 'GET') throw new TypeError('GET cannot carry a request body');
      if (options.body instanceof FormData) {
        headers.delete('content-type');
        init.body = options.body;
      } else {
        if (!headers.has('content-type')) headers.set('Content-Type','application/json');
        init.body = JSON.stringify(streaming ? cleanSsePayload(options.body) : options.body);
      }
    }
    const response=await this.#fetch(this.#url(path,options.query,service),init);
    if(sessionProvider&&expectedEpoch!==undefined){
      const owner=authorization??{sessionEpoch:expectedEpoch};
      sessionProvider.assertCurrent(owner);
      this.#requestAuth.set(response,{authorization:owner,provider:sessionProvider,managed:!!authorization});
      if(response.status===401&&authorization)sessionProvider.rejectAuthorization(owner);
      if(streaming&&response.headers.get('content-type')?.includes('application/json')){
        const raw=await response.clone().json().catch(()=>undefined);
        sessionProvider.assertCurrent(owner);
        if(raw&&typeof raw==='object'&&raw.code===401&&authorization)sessionProvider.rejectAuthorization(owner);
      }
    }
    return response;
  }
  /** Low-level API-origin request; no UI logout, retries, cache, or policy mutations. */
  async request<T=unknown>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    return this.#json<T>(method,path,options);
  }
  /** Snapshot the managed account for caller-defined multi-request workflows. */
  sessionOptions(options:RequestOptions={}):RequestOptions {
    return this.#options.auth?{...options,sessionEpoch:options.sessionEpoch??this.#options.auth.epoch}:{...options};
  }
  async #json<T>(method: HttpMethod,path:string,options:RequestOptions,service='api'):Promise<ApiResult<T>> {
    if(service==='api'&&options.auth!=='none'&&this.#options.auth)options={...options,sessionEpoch:options.sessionEpoch??this.#options.auth.epoch};
    for(let attempt=0;;attempt++){
      const response=await this.#request(method,path,options,service);
      const raw=await responseJson(response);
      const owner=this.#requestAuth.get(response);
      if(owner)owner.provider.assertCurrent(owner.authorization);
      const code=raw&&typeof raw==='object'?(raw as JsonRecord).code:undefined;
      if(owner?.managed&&(response.status===401||code===401)){
        const retry=options.retryOnUnauthorized??method==='GET';
        if(attempt===0&&retry){
          await owner.provider.recoverUnauthorized(owner.authorization);
          continue;
        }
        owner.provider.rejectAuthorization(owner.authorization);
      }
      checkResponse(response,raw,!options.returnEnvelope,options.allowBusinessCodes);
      return {data:(options.returnEnvelope?raw:extractEnvelope(raw)) as T|null|undefined,raw,status:response.status,headers:response.headers};
    }
  }
  #endpoint(name: EndpointName, options: EndpointCallOptions): {definition:EndpointDefinition;path:string;query:Query} {
    const definition: EndpointDefinition = ENDPOINTS[name];
    if (!definition) throw new TypeError(`Unknown endpoint ${String(name)}`);
    const path = definition.path.replace(/\{([^}]+)\}/g,(_match,key:string)=>{
      const value = options.path?.[key];
      if (value === undefined || value === null || String(value) === '') throw new TypeError(`Missing path parameter ${key}`);
      return encodeURIComponent(String(value));
    });
    return {definition,path,query:{...definition.defaultQuery,...options.query}};
  }
  /** All catalogued HTTP endpoints; open schemas keep unknown fields unchanged. */
  async call<T=unknown>(name:EndpointName,options:EndpointCallOptions = {}):Promise<ApiResult<T>> {
    const {definition:d,path,query} = this.#endpoint(name,options);
    if (d.transport === 'sse') throw new TypeError('Use stream() for an SSE endpoint');
    if (d.transport === 'multipart' && !(options.body instanceof FormData)) throw new TypeError('Multipart endpoint requires FormData; use uploadFile() for chat files');
    const responseType = options.responseType ?? (d.transport === 'binary' ? 'blob' : 'json');
    if (responseType === 'json') {
      if (name === 'chatFileUpload') return this.#upload(path,{...options,query},d.base) as Promise<ApiResult<T>>;
      return this.#json<T>(d.method,path,{...options,query},d.base);
    }
    const response = await this.#request(d.method,path,{...options,query},d.base);
    if (!response.ok) checkResponse(response,await responseJson(response));
    const data = responseType === 'blob' ? await response.blob() : await response.text();
    const owner=this.#requestAuth.get(response);if(owner)owner.provider.assertCurrent(owner.authorization);
    return {data:data as T,raw:data,status:response.status,headers:response.headers};
  }
  stream(name:EndpointName,options:EndpointCallOptions & StreamOptions = {}):SseSession {
    const {definition:d,path,query} = this.#endpoint(name,options);
    if (d.transport !== 'sse') throw new TypeError('Endpoint is not an SSE transport');
    const body = options.body as UserSayRequest|undefined;
    const profile = options.profile ?? (name === 'jobMatchStream' ? 'job-match' : agentProfile(body?.agent_hint?.conversionType));
    return this.#track(new SseSession(signal=>this.#request(d.method,path,{...options,query,signal},d.base,true),{...options,profile}));
  }
  userSay(body: UserSayRequest,options:StreamOptions = {}):SseSession {
    return this.#track(new SseSession(signal=>this.#request('POST','/wapi/partners/v2/chat/userSay',{body,headers:options.headers,signal},'api',true),{...options,profile:options.profile ?? agentProfile(body.agent_hint?.conversionType)}));
  }
  retry(body:RetryRequest,options:StreamOptions = {}):SseSession {
    return this.#track(new SseSession(signal=>this.#request('POST','/wapi/partners/v2/chat/message/retry',{body,headers:options.headers,signal},'api',true),{...options,profile:options.profile ?? 'main'}));
  }
  #track(stream:SseSession):SseSession {
    if(this.#options.auth){this.#streams.set(stream,this.#options.auth.epoch);void stream.completion.then(()=>this.#streams.delete(stream));}
    return stream;
  }
  /** Releases auth listeners and locally cancels this client's live streams. */
  dispose():void{this.#disposed=true;this.#unsubscribeAuth?.();this.#unsubscribeAuth=undefined;for(const stream of this.#streams.keys())stream.abort();this.#streams.clear();}
  stopSay(conversationId:Id,options:RequestOptions = {}):Promise<ApiResult> {
    return this.request('POST','/wapi/partners/v2/chat/stopSay',{...options,body:{conversation_id:conversationId}});
  }
  conversations(query:Query = {}):Promise<ApiResult<Conversation[]>> {
    return this.call<Conversation[]>('chatConversationsList',{query});
  }
  messages(query:Query):Promise<ApiResult<ChatMessage[]>> {
    return this.call<ChatMessage[]>('chatMessagesList',{query});
  }
  conversation(id:Id):Promise<ApiResult<Conversation>> {
    return this.call<Conversation>('chatConversationGet',{path:{id}});
  }
  bootstrap(options:RequestOptions = {}):Promise<ApiResult<JsonRecord>> {
    return this.request('GET','/wapi/partners/v2/homepage/bootstrap',options);
  }
  getWorkSettings(options:RequestOptions = {}):Promise<ApiResult<WorkSettings>> {
    return this.request('GET','/wapi/user/geek/agent/work-settings',options);
  }
  /** Direct work-mode POST only. Does not imply proxy shutdown or office refresh. */
  setWorkMode(workMode:ProductWorkMode,options:RequestOptions = {}):Promise<ApiResult<WorkSettings>> {
    return this.request('POST','/wapi/user/geek/agent/work-settings/work-mode',{...options,body:{workMode}});
  }
  canEnableProxy(mode:ProxyMode,options:RequestOptions = {}):Promise<ApiResult<JsonRecord>> {
    return this.request('GET','/wapi/user/v2/agent/proxy/can-enable',{...options,query:{...options.query,mode}});
  }
  toggleProxy(enabled:boolean,mode?:ProxyMode,options:RequestOptions = {}):Promise<ApiResult> {
    return this.request('POST','/wapi/user/v2/agent/proxy/toggle',{...options,body:{enabled,...(enabled && mode ? {mode} : {})}});
  }
  saveCommunication(autoChatEnabled:boolean,options:RequestOptions = {}):Promise<ApiResult<WorkSettings>> {
    return this.request('POST','/wapi/user/geek/agent/work-settings/communication',{...options,body:{autoChatEnabled}});
  }
  saveDelivery(body:DeliverySettingsInput,options:RequestOptions = {}):Promise<ApiResult<WorkSettings>> {
    return this.request('POST','/wapi/user/geek/agent/work-settings/delivery',{...options,body});
  }
  async #upload(path:string,options:RequestOptions,service='api'):Promise<ApiResult<JsonRecord>> {
    const response = await this.#request('POST',path,options,service);
    const raw = await responseJson(response);
    const owner=this.#requestAuth.get(response);if(owner){owner.provider.assertCurrent(owner.authorization);if(owner.managed&&raw&&typeof raw==='object'&&(raw as JsonRecord).code===401)owner.provider.rejectAuthorization(owner.authorization);}
    checkResponse(response,raw,false);
    const result = raw && typeof raw === 'object' ? (raw as JsonRecord).result : undefined;
    if (!result || typeof result !== 'object' || !(result as JsonRecord).file_id) throw new ProtocolError('Upload response did not include result.file_id');
    return {data:result as JsonRecord,raw,status:response.status,headers:response.headers};
  }
  uploadFile(file:Blob,filename:string,options:RequestOptions = {}):Promise<ApiResult<JsonRecord>> {
    if (!filename) throw new TypeError('A filename is required');
    const body = new FormData();
    body.append('file',file,filename);
    return this.#upload('/wapi/partners/v2/chat/file/upload',{...options,body});
  }
  async downloadFile(fileId:Id,options:RequestOptions = {}):Promise<ApiResult<Blob>> {
    const response = await this.#request('GET','/wapi/partners/v2/chat/file/download',{...options,query:{...options.query,fileId}});
    if (!response.ok) checkResponse(response,await responseJson(response));
    const data = await response.blob();
    const owner=this.#requestAuth.get(response);if(owner)owner.provider.assertCurrent(owner.authorization);
    return {data,raw:data,status:response.status,headers:response.headers};
  }
}
