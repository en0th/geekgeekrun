import { AuthSessionManager } from './auth-session.js';
import type { AuthSession, AuthSessionOptions } from './auth-session.js';
import { BusinessError, LoginBootstrapError, LoginRejectedError, ProtocolError, SessionChangedError } from './errors.js';
import { ZhijueAIClient } from './client.js';
import type { ClientOptions } from './client.js';
import type { ApiResult, Id, JsonRecord, RequestOptions } from './types.js';

export interface CaptchaProof extends JsonRecord {
  type:number;
  randKey?:string;
  challenge?:string;
  validate?:string;
  seccode?:string;
  captcha?:string;
  wyCaptchaId?:string;
}
export const LOGIN_ERROR_CODES=Object.freeze({
  2002:'USER_FROZEN',7002:'INVALID_VERIFICATION_CODE',400403:'NEED_INVITE_CODE',
  400404:'BOSS_ZP_ACCOUNT_NOT_FOUND',400405:'BOSS_ZP_SCHOOL_NOT_MATCH',400429:'TOO_MANY_REGISTER',
  400430:'ZP_HOME_BANNER_DAILY_LIMIT',400457:'INVITE_CODE_NOT_FOUND',400458:'INVITE_CODE_USED',
  400460:'INVITE_CODE_EXPIRED',400461:'INVITE_CODE_INVALID',400462:'INVITE_CODE_CONTEXT_EXPIRED',400464:'INVITE_CODE_GRANT_NOT_FOUND',
} as const);
export function buildPhoneCodeRequest(phone:string,proof:CaptchaProof):JsonRecord {
  const value=Number(proof.type),type=Number.isFinite(value)?value:0;
  const body:JsonRecord={phone,loginDevice:'H5',captchaType:type,geetVerify:{},wyVerify:{},imageVerify:{}};
  if(type===1)body.geetVerify={key:proof.randKey,clientType:type,challenge:proof.challenge,validate:proof.validate,seccode:proof.seccode};
  else if(type===3)body.imageVerify={key:proof.randKey,captcha:proof.captcha};
  else if(type===4)body.wyVerify={captchaId:proof.wyCaptchaId,validate:proof.validate};
  return body;
}
export interface LoginResult extends JsonRecord {
  status?:string;
  userId?:Id|null;
  accessToken?:string;
  accessExpiresIn?:number;
  expiresIn?:number;
  userInfo?:JsonRecord;
  message?:string;
}
export interface LoginOutcome {
  login:ApiResult<LoginResult>;
  profile?:ApiResult<JsonRecord>;
  /** false means the observed UI condition was not indicated, not a server permission grant. */
  authorizationRequired:boolean|'unknown';
  sessionEpoch:number;
}
export interface PhoneLoginOptions extends Omit<RequestOptions,'body'|'query'|'returnEnvelope'|'auth'|'retryOnUnauthorized'> {
  platform?:'ios'|'android'|'other';
  fetchProfile?:boolean;
  /** Optional deployment-specific login gates; no App UI/navigation side effects. */
  validateLogin?:(result:LoginResult)=>void|Promise<void>;
}
export function sessionFromLogin(result:LoginResult,now=Date.now()):AuthSession {
  if(result.status!=='success'||result.userId===undefined||result.userId===null)throw new LoginRejectedError(result.message||'Login did not return success/userId',result);
  if(typeof result.accessToken!=='string'||!result.accessToken.trim())throw new LoginRejectedError('No accessToken was returned; cookie-only/legacy login needs runtime evidence',result);
  const ttl=typeof result.accessExpiresIn==='number'?result.accessExpiresIn:typeof result.expiresIn==='number'?result.expiresIn:7200;
  if(!Number.isFinite(ttl)||ttl<0)throw new ProtocolError('Login token lifetime must be a finite nonnegative number of seconds');
  return {accessToken:result.accessToken,expiresAt:now+ttl*1000,userId:result.userId};
}

export class ZhijueAuthClient {
  readonly #client:ZhijueAIClient;
  readonly session:AuthSessionManager;
  readonly #now:()=>number;
  constructor(client:ZhijueAIClient,session:AuthSessionManager,options:{now?:()=>number}={}){this.#client=client;this.session=session;this.#now=options.now??Date.now;}
  captchaType(options:RequestOptions={}):Promise<ApiResult<JsonRecord>>{
    return this.#client.request('GET','/wapi/zppassport/captcha/getTypeV2',{...options,auth:'none',retryOnUnauthorized:false});
  }
  /** Proof comes from the real captcha provider; no bypass or fabricated solution. */
  async sendPhoneCode(phone:string,proof:CaptchaProof,options:RequestOptions={}):Promise<ApiResult> {
    if(!phone.trim())throw new TypeError('A phone number is required');
    const result=await this.#client.request('POST','/wapi/user/auth/phone/sendLoginVerifyCodeV2',{...options,body:buildPhoneCodeRequest(phone,proof),auth:'none',retryOnUnauthorized:false,returnEnvelope:true});
    const raw=result.raw&&typeof result.raw==='object'?result.raw as JsonRecord:{};
    const code=Number(raw.code??0);
    if(Number.isFinite(code)&&code!==0&&code!==200)throw new BusinessError(String(raw.msg||raw.message||'Verification-code request was rejected'),result.status,result.raw,result.headers,code);
    return result;
  }
  async loginWithPhoneCode(phone:string,code:string,options:PhoneLoginOptions={}):Promise<LoginOutcome> {
    if(!phone.trim()||!code.trim())throw new TypeError('Phone and verification code are required');
    const source=options.platform==='ios'?'JOBSEEKER_MOBILE_IOS':options.platform==='android'?'JOBSEEKER_MOBILE_ANDROID':'SELF';
    return this.#login('POST','/wapi/user/auth/phone/login',{
      ...options,body:{phone,code,userIdentity:'GEEK',sessionType:'APP',source},auth:'none',retryOnUnauthorized:false,
    },options);
  }
  /** A separately supplied valid ZP ticket, not an App Bearer or AI message ID. */
  loginWithZpTicket(wt2:string,options:PhoneLoginOptions={}):Promise<LoginOutcome> {
    if(!wt2.trim())throw new TypeError('A ZP login ticket is required');
    return this.#login('POST','/wapi/user/auth/zp/get/login',{...options,query:{wt2},body:undefined,auth:'none',retryOnUnauthorized:false},options);
  }
  async #login(method:'POST',path:string,request:RequestOptions,options:PhoneLoginOptions):Promise<LoginOutcome> {
    const attempt=this.session.beginLogin();
    let adopted=false;
    try{
      const login=await this.#client.request<LoginResult>(method,path,{...request,returnEnvelope:false});
      if(attempt!==this.session.epoch)throw new SessionChangedError();
      if(!login.data||typeof login.data!=='object')throw new LoginRejectedError('Login returned no result object',login.raw);
      await options.validateLogin?.(login.data);
      this.session.completeLogin(sessionFromLogin(login.data,this.#now()),attempt);
      adopted=true;
      const profile=options.fetchProfile===false?undefined:await this.profile({sessionEpoch:attempt});
      if(attempt!==this.session.epoch)throw new SessionChangedError();
      const user=profile?.data??login.data.userInfo;
      const authorizationRequired=user&&typeof user==='object'?user.identity==='GEEK'&&user.status==='NOT_AUTHORIZED_ZP':'unknown';
      return {login,profile,authorizationRequired,sessionEpoch:attempt};
    }catch(error){this.session.cancelLogin(attempt);if(adopted&&attempt===this.session.epoch&&!(error instanceof SessionChangedError))throw new LoginBootstrapError(attempt,error);throw error;}
  }
  profile(options:RequestOptions={}):Promise<ApiResult<JsonRecord>> {
    return this.#client.request('GET','/wapi/user/info',{...options,auth:'required'});
  }
  /** Explicit BOSS-data consent workflow; never runs as an automatic login side effect. */
  async authorizeBossData(options:RequestOptions={}):Promise<ApiResult<JsonRecord>> {
    options={...options,sessionEpoch:options.sessionEpoch??this.session.epoch};
    await this.#client.request('POST','/wapi/user/agreement/agree',{...options,body:{agreeInfos:[{agreementCode:'Authorize_ZP_GEEK',version:'1.0.0',hasAgreed:true}]},auth:'required',retryOnUnauthorized:false});
    await this.#client.request('POST','/wapi/user/resumeV2/zp/resume/sync',{...options,body:undefined,auth:'required',retryOnUnauthorized:false});
    await this.#client.request('POST','/wapi/user/updateInfo',{...options,body:{identity:'GEEK'},auth:'required',retryOnUnauthorized:false});
    return this.profile(options);
  }
  /** Attempts server logout; local session invalidation occurs even on failure. */
  async logout(options:RequestOptions={}):Promise<ApiResult> {
    const epoch=this.session.epoch;
    try{return await this.#client.request('POST','/wapi/user/auth/logout',{...options,body:undefined,retryOnUnauthorized:false,sessionEpoch:epoch});}
    finally{if(this.session.epoch===epoch)this.session.clear();}
  }
}

/** Constructs a consistently wired API/auth/session set without making requests. */
export function createAuthenticatedClient(options:Omit<ClientOptions,'auth'|'getAccessToken'>,sessionOptions:AuthSessionOptions={}){
  const sessions=new AuthSessionManager(sessionOptions);
  const client=new ZhijueAIClient({...options,auth:sessions});
  const auth=new ZhijueAuthClient(client,sessions,{now:sessionOptions.now});
  return {sessions,client,auth};
}
