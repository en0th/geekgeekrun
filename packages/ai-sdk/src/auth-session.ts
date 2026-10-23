import { AuthRenewalError, ReauthenticationRequiredError, SessionChangedError } from './errors.js';
import type { AuthAuthorization, AuthSessionProvider, Id } from './types.js';

export interface AuthSession {
  accessToken:string;
  /** Absolute epoch milliseconds; App accessExpiresIn/expiresIn is seconds. */
  expiresAt:number;
  userId?:Id;
  /** Only for a caller-supplied verified adapter; not inferred from this App login. */
  refreshToken?:string;
}
export type RenewalReason='expired'|'unauthorized'|'manual';
export interface RenewalContext {
  session:Readonly<AuthSession>;
  reason:RenewalReason;
  signal:AbortSignal;
}
export interface AuthSessionOptions {
  now?:()=>number;
  expirySkewMs?:number;
  /** No default URL: the recovered build explicitly has no refresh operation. */
  renew?:(context:RenewalContext)=>Promise<AuthSession>;
}
function validated(session:AuthSession):AuthSession {
  if(typeof session.accessToken!=='string'||!session.accessToken.trim())throw new TypeError('A nonempty access token is required');
  if(!Number.isFinite(session.expiresAt)||session.expiresAt<0)throw new TypeError('A finite absolute expiresAt in milliseconds is required');
  return {...session};
}

/** Memory only; caller-owned persistence and renewal. No App credential discovery. */
export class AuthSessionManager implements AuthSessionProvider {
  #session:AuthSession|null=null;
  #epoch=0;
  #tokenRevision=0;
  #authenticating=false;
  #renewal:{epoch:number;promise:Promise<AuthAuthorization>;controller:AbortController}|null=null;
  readonly #listeners=new Set<(epoch:number)=>void>();
  readonly #options:AuthSessionOptions;
  readonly #now:()=>number;
  readonly #skew:number;
  constructor(options:AuthSessionOptions={}) {
    this.#options=options;this.#now=options.now??Date.now;this.#skew=options.expirySkewMs??30000;
    if(!Number.isFinite(this.#skew)||this.#skew<0)throw new TypeError('Nonnegative expirySkewMs required');
  }
  get epoch():number{return this.#epoch;}
  get hasSession():boolean{return this.#session!==null;}
  get authenticated():boolean{return !!this.#session&&this.#session.expiresAt>this.#now();}
  /** Redacted view suitable for logging. */
  snapshot():{userId?:Id;expiresAt?:number;authenticated:boolean;authenticating:boolean;epoch:number} {
    return {userId:this.#session?.userId,expiresAt:this.#session?.expiresAt,authenticated:this.authenticated,authenticating:this.#authenticating,epoch:this.#epoch};
  }
  /** Explicit secret-bearing export, e.g. to a caller's secure storage. */
  exportSession():AuthSession|null{return this.#session?{...this.#session}:null;}
  toJSON():unknown{return this.snapshot();}
  #notify():void{for(const listener of this.#listeners){try{listener(this.#epoch);}catch{/* Cleanup listeners cannot interrupt session invalidation. */}}}
  #newEpoch():number {
    this.#epoch++;this.#tokenRevision++;this.#renewal?.controller.abort(new SessionChangedError());this.#renewal=null;
    this.#session=null;this.#authenticating=false;this.#notify();return this.#epoch;
  }
  onSessionChange(listener:(epoch:number)=>void):()=>void{this.#listeners.add(listener);return()=>this.#listeners.delete(listener);}
  /** Replacing/importing a session is an account boundary; old responses cannot adopt it. */
  setSession(session:AuthSession):void{const copy=validated(session);this.#newEpoch();this.#session=copy;this.#notify();}
  clear():void{this.#newEpoch();}
  beginLogin():number{const epoch=this.#newEpoch();this.#authenticating=true;return epoch;}
  completeLogin(session:AuthSession,attempt:number):void {
    if(attempt!==this.#epoch||!this.#authenticating)throw new SessionChangedError();
    this.#session=validated(session);this.#tokenRevision++;this.#authenticating=false;this.#notify();
  }
  cancelLogin(attempt:number):void{if(attempt===this.#epoch&&this.#authenticating){this.#session=null;this.#authenticating=false;this.#notify();}}
  assertCurrent(previous:AuthAuthorization):void{if(previous.sessionEpoch!==this.#epoch)throw new SessionChangedError();}
  #authorization():AuthAuthorization{return {accessToken:this.#session?.accessToken,sessionEpoch:this.#epoch,tokenRevision:this.#tokenRevision};}
  async authorize():Promise<AuthAuthorization> {
    if(this.#authenticating)throw new ReauthenticationRequiredError('missing_session');
    const session=this.#session;
    if(!session)return this.#authorization();
    const remaining=session.expiresAt-this.#now();
    if(remaining>this.#skew||remaining>0&&!this.#options.renew)return this.#authorization();
    if(!this.#options.renew)throw new ReauthenticationRequiredError('expired');
    return this.#renew('expired');
  }
  /** Invalidate only the rejected token, never a newer token or different account. */
  rejectAuthorization(previous:AuthAuthorization):void {
    if(previous.sessionEpoch===this.#epoch&&this.#session&&previous.accessToken===this.#session.accessToken&&(previous.tokenRevision===undefined||previous.tokenRevision===this.#tokenRevision)){
      this.#session={...this.#session,expiresAt:0};
    }
  }
  async recoverUnauthorized(previous:AuthAuthorization):Promise<AuthAuthorization> {
    this.assertCurrent(previous);
    if(this.#session?.accessToken!==previous.accessToken||previous.tokenRevision!==undefined&&previous.tokenRevision!==this.#tokenRevision)return this.authorize();
    this.rejectAuthorization(previous);
    if(!this.#options.renew)throw new ReauthenticationRequiredError('unauthorized');
    return this.#renew('unauthorized');
  }
  async renewNow():Promise<AuthAuthorization>{return this.#renew('manual');}
  async #renew(reason:RenewalReason):Promise<AuthAuthorization> {
    if(this.#renewal?.epoch===this.#epoch)return this.#renewal.promise;
    const session=this.#session;
    if(!session)throw new ReauthenticationRequiredError('missing_session');
    const renew=this.#options.renew;
    if(!renew)throw new ReauthenticationRequiredError('no_renewal_adapter');
    const epoch=this.#epoch,controller=new AbortController();
    let task!:Promise<AuthAuthorization>;
    task=Promise.resolve().then(()=>renew({session:{...session},reason,signal:controller.signal})).then(value=>{
      if(epoch!==this.#epoch||this.#renewal?.promise!==task)throw new SessionChangedError();
      const next=validated(value);
      if(next.expiresAt<=this.#now())throw new TypeError('The renewal adapter returned an expired token');
      if(session.userId!==undefined&&next.userId!==undefined&&String(session.userId)!==String(next.userId))throw new SessionChangedError();
      this.#session={...next,userId:next.userId??session.userId};this.#tokenRevision++;
      return this.#authorization();
    }).catch(error=>{
      if(epoch!==this.#epoch||error instanceof SessionChangedError)throw new SessionChangedError();
      throw error instanceof ReauthenticationRequiredError?error:new AuthRenewalError(error);
    }).finally(()=>{if(this.#renewal?.promise===task)this.#renewal=null;});
    this.#renewal={epoch,promise:task,controller};return task;
  }
}
