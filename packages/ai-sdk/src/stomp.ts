import { ProtocolError } from './errors.js';
import type { JsonRecord } from './types.js';

export interface StompFrame { command:string; headers:Record<string,string>; body:string; }
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function escapeHeader(value:string):string { return value.replace(/\\/g,'\\\\').replace(/\r/g,'\\r').replace(/\n/g,'\\n').replace(/:/g,'\\c'); }
function unescapeHeader(value:string):string {
  return value.replace(/\\(.)/g,(_match,char:string)=>{
    if (char === 'n') return '\n';
    if (char === 'r') return '\r';
    if (char === 'c') return ':';
    if (char === '\\') return '\\';
    throw new ProtocolError('Invalid STOMP header escape');
  });
}
export function encodeStompFrame(frame:StompFrame):string {
  if (!/^[A-Z]+$/.test(frame.command)) throw new TypeError('Invalid STOMP command');
  const plain = frame.command === 'CONNECT' || frame.command === 'CONNECTED';
  const headers = {...frame.headers,'content-length':String(encoder.encode(frame.body).byteLength)};
  const lines = [frame.command];
  for (const [key,value] of Object.entries(headers)) {
    if (plain && (/[\r\n:]/.test(key) || /[\r\n]/.test(value))) throw new TypeError('Invalid CONNECT header');
    lines.push(`${plain?key:escapeHeader(key)}:${plain?value:escapeHeader(value)}`);
  }
  return `${lines.join('\n')}\n\n${frame.body}\0`;
}
/** Byte-oriented content-length supports split UTF-8 and NUL inside a body. */
export class StompParser {
  #buffer = new Uint8Array(0);
  constructor(readonly maxBufferBytes = 16*1024*1024) {}
  push(input: string|Uint8Array):StompFrame[] {
    const incoming = typeof input === 'string' ? encoder.encode(input) : input;
    const combined = new Uint8Array(this.#buffer.length+incoming.length);
    combined.set(this.#buffer); combined.set(incoming,this.#buffer.length);
    this.#buffer = combined;
    const frames:StompFrame[] = [];
    while (this.#buffer.length) {
      let skip = 0;
      while (this.#buffer[skip] === 10 || this.#buffer[skip] === 13) skip++;
      if (skip) this.#buffer = this.#buffer.slice(skip);
      if (!this.#buffer.length) break;
      let end = -1, separator = 0;
      for (let i=0;i<this.#buffer.length-1;i++) {
        if (this.#buffer[i]===10 && this.#buffer[i+1]===10) { end=i;separator=2;break; }
        if (this.#buffer[i]===13 && this.#buffer[i+1]===10 && this.#buffer[i+2]===13 && this.#buffer[i+3]===10) { end=i;separator=4;break; }
      }
      if (end<0) break;
      const lines = decoder.decode(this.#buffer.slice(0,end)).split(/\r?\n/);
      const command = lines.shift() ?? '';
      if (!/^[A-Z]+$/.test(command)) throw new ProtocolError('Invalid STOMP command');
      const headers:Record<string,string> = {};
      const plain = command==='CONNECT'||command==='CONNECTED';
      for (const line of lines) {
        const colon = line.indexOf(':');
        if (colon<1) throw new ProtocolError('Invalid STOMP header');
        const key = plain ? line.slice(0,colon) : unescapeHeader(line.slice(0,colon));
        const value = plain ? line.slice(colon+1) : unescapeHeader(line.slice(colon+1));
        if (!Object.hasOwn(headers,key)) headers[key] = value;
      }
      const bodyStart = end+separator;
      let bodyEnd:number;
      if (headers['content-length'] !== undefined) {
        if (!/^\d+$/.test(headers['content-length'])) throw new ProtocolError('Invalid STOMP content-length');
        const length = Number(headers['content-length']);
        if (!Number.isSafeInteger(length)||length>this.maxBufferBytes) throw new ProtocolError('STOMP body exceeds limit');
        bodyEnd = bodyStart+length;
        if (this.#buffer.length<=bodyEnd) break;
        if (this.#buffer[bodyEnd]!==0) throw new ProtocolError('STOMP body missing NUL terminator');
      } else {
        bodyEnd = this.#buffer.indexOf(0,bodyStart);
        if (bodyEnd<0) break;
      }
      if (bodyEnd>this.maxBufferBytes) throw new ProtocolError('STOMP frame exceeds limit');
      frames.push({command,headers,body:decoder.decode(this.#buffer.slice(bodyStart,bodyEnd))});
      this.#buffer = this.#buffer.slice(bodyEnd+1);
    }
    if (this.#buffer.length>this.maxBufferBytes) throw new ProtocolError('STOMP buffer exceeds limit');
    return frames;
  }
}

export interface WebSocketLike {
  readonly readyState:number;
  send(data:string):void;
  close(code?:number,reason?:string):void;
  addEventListener(type:'open'|'message'|'close'|'error',listener:(event:any)=>void):void;
}
export interface AssistantPush { frame:StompFrame; data:unknown; }
export interface AssistantStompOptions {
  url:string;
  getAccessToken?:()=>string|null|undefined|Promise<string|null|undefined>;
  /** Adapter receives upgrade headers. Native browser WebSocket cannot set them. */
  webSocketFactory?:(url:string,protocols:string[],upgradeHeaders:Record<string,string>)=>WebSocketLike;
  onMessage:(push:AssistantPush)=>void;
  onError?:(error:unknown)=>void;
  onClose?:()=>void;
  destination?:string;
  heartbeatOutgoing?:number;
  heartbeatIncoming?:number;
  connectTimeoutMs?:number;
  connectHeaders?:Record<string,string>;
}

/** Explicit connect/close, no automatic reconnect or application-store mutation. */
export class AssistantStompClient {
  readonly #options:AssistantStompOptions;
  #socket:WebSocketLike|null=null;
  #connected=false;
  #connection:Promise<void>|null=null;
  #reject:((error:unknown)=>void)|undefined;
  #generation=0;
  #timers:ReturnType<typeof setInterval>[]=[];
  #timeout:ReturnType<typeof setTimeout>|undefined;
  constructor(options:AssistantStompOptions) {
    const url=new URL(options.url);
    if (!['ws:','wss:'].includes(url.protocol)||url.username||url.password||url.search||url.hash) throw new TypeError('Explicit WS(S) URL without credentials/query/hash required');
    for(const value of [options.heartbeatIncoming,options.heartbeatOutgoing])if(value!==undefined&&(!Number.isSafeInteger(value)||value<0))throw new TypeError('Heartbeat must be a nonnegative integer');
    if(options.connectTimeoutMs!==undefined&&(!Number.isSafeInteger(options.connectTimeoutMs)||options.connectTimeoutMs<=0))throw new TypeError('Positive connectTimeoutMs required');
    this.#options=options;
  }
  get connected():boolean { return this.#connected; }
  async connect():Promise<void> {
    if (this.#connection) return this.#connection;
    const generation=++this.#generation;
    let resolve!:()=>void,reject!:(error:unknown)=>void;
    const connection=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    this.#connection=connection; this.#reject=reject;
    // Attach a rejection observer before awaiting token resolution.
    void connection.catch(()=>{});
    try {
      const token=await this.#options.getAccessToken?.();
      if (generation!==this.#generation) throw new ProtocolError('STOMP connection cancelled');
      const auth:Record<string,string>=token?{Authorization:`Bearer ${token}`} : {};
      const factory=this.#options.webSocketFactory ?? ((url:string,protocols:string[])=>new WebSocket(url,protocols));
      const socket=factory(this.#options.url,['v12.stomp','v11.stomp','v10.stomp'],auth);
      this.#socket=socket;
      const parser=new StompParser();
      let incomingChain=Promise.resolve(),lastReceived=Date.now();
      const outgoing=this.#options.heartbeatOutgoing ?? 25000;
      const incoming=this.#options.heartbeatIncoming ?? 25000;
      const current=()=>this.#socket===socket&&generation===this.#generation;
      const fail=(error:unknown)=>{
        if(!current())return;
        reject(error);
        this.#notifyError(error);
        this.close();
      };
      this.#timeout=setTimeout(()=>{if(current()&&!this.#connected)fail(new ProtocolError('STOMP CONNECTED timeout'));},this.#options.connectTimeoutMs??15000);
      socket.addEventListener('open',()=>{
        if (!current()) return;
        try{socket.send(encodeStompFrame({command:'CONNECT',headers:{'accept-version':'1.2,1.1,1.0','heart-beat':`${outgoing},${incoming}`,...auth,...this.#options.connectHeaders},body:''}));}catch(error){fail(error);}
      });
      socket.addEventListener('message',(event:{data:unknown})=>{
        if (!current()) return;
        lastReceived=Date.now();
        incomingChain=incomingChain.then(async()=>{
          let data=event.data;
          if (data instanceof Blob) data=new Uint8Array(await data.arrayBuffer());
          else if (data instanceof ArrayBuffer) data=new Uint8Array(data);
          if (typeof data!=='string' && !(data instanceof Uint8Array)) throw new ProtocolError('Unsupported WebSocket message type');
          if (!current()) return;
          for (const frame of parser.push(data)) {
            if (frame.command==='CONNECTED') {
              if (this.#connected) continue;
              if(this.#timeout!==undefined)clearTimeout(this.#timeout);
              this.#timeout=undefined; this.#connected=true;
              socket.send(encodeStompFrame({command:'SUBSCRIBE',headers:{id:'douzi-sdk-0',destination:this.#options.destination??'/user/queue/douzi',ack:'auto'},body:''}));
              const heartbeat=(frame.headers['heart-beat']??'0,0').split(',').map(Number);
              const sx=heartbeat[0]??0,sy=heartbeat[1]??0;
              if(outgoing>0&&sy>0)this.#timers.push(setInterval(()=>{if(current()&&this.#connected)try{socket.send('\n');}catch(error){fail(error);}},Math.max(outgoing,sy)));
              if(incoming>0&&sx>0){const wait=Math.max(incoming,sx);this.#timers.push(setInterval(()=>{if(current()&&Date.now()-lastReceived>wait*2)fail(new ProtocolError('STOMP heartbeat timeout'));},Math.max(1000,Math.floor(wait/2))));}
              resolve();
            } else if(frame.command==='MESSAGE') {
              let data:unknown=frame.body;
              try{data=JSON.parse(frame.body);}catch{/* Preserve non-JSON payload. */}
              this.#options.onMessage({frame,data});
            } else if(frame.command==='ERROR') {
              const error=new ProtocolError(frame.body||frame.headers.message||'STOMP ERROR');
              fail(error);
            }
          }
        }).catch(fail);
      });
      socket.addEventListener('error',fail);
      socket.addEventListener('close',()=>{
        if(!current())return;
        this.#clearTimers();this.#connected=false;this.#socket=null;this.#connection=null;
        reject(new ProtocolError('WebSocket closed'));this.#options.onClose?.();
      });
    } catch(error) {
      reject(error);
      if(generation===this.#generation&&this.#connection===connection){
        this.#clearTimers();this.#connection=null;this.#reject=undefined;
      }
    }
    return connection;
  }
  #clearTimers():void {
    if(this.#timeout!==undefined)clearTimeout(this.#timeout);
    this.#timeout=undefined;
    for(const timer of this.#timers)clearInterval(timer);
    this.#timers=[];
  }
  #notifyError(error:unknown):void {
    try{this.#options.onError?.(error);}catch{/* User error callback cannot interrupt transport cleanup. */}
  }
  close():void {
    this.#generation++;
    this.#clearTimers();
    const socket=this.#socket;
    const wasConnected=this.#connected;
    const reject=this.#reject;
    this.#socket=null;this.#connection=null;
    this.#connected=false;this.#reject=undefined;
    reject?.(new ProtocolError('STOMP connection closed by caller'));
    try{
      if(socket&&socket.readyState===1){
        if(wasConnected)socket.send(encodeStompFrame({command:'UNSUBSCRIBE',headers:{id:'douzi-sdk-0'},body:''}));
        socket.send(encodeStompFrame({command:'DISCONNECT',headers:{},body:''}));
      }
    }catch(error){this.#notifyError(error);}
    finally{
      try{socket?.close(1000,'client close');}catch(error){this.#notifyError(error);}
    }
  }
}
