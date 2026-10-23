export class HttpError extends Error {
  override name = 'HttpError';
  constructor(message: string, readonly status: number, readonly raw: unknown, readonly headers: Headers) {
    super(message);
  }
}
export class AuthenticationError extends HttpError {
  override name = 'AuthenticationError';
}
export class BusinessError extends HttpError {
  override name = 'BusinessError';
  constructor(message: string, status: number, raw: unknown, headers: Headers, readonly code: number) {
    super(message, status, raw, headers);
  }
}
export class IncompleteStreamError extends Error {
  override name = 'IncompleteStreamError';
  constructor() { super('SSE ended without a recognized [DONE] marker'); }
}
export class ProtocolError extends Error {
  override name = 'ProtocolError';
}
export class ReauthenticationRequiredError extends Error {
  override name = 'ReauthenticationRequiredError';
  constructor(readonly reason:'missing_session'|'expired'|'unauthorized'|'no_renewal_adapter', options?:ErrorOptions) {
    super(`Authentication requires a new login or a verified renewal adapter (${reason})`,options);
  }
}
export class SessionChangedError extends Error {
  override name = 'SessionChangedError';
  constructor(){super('The authentication session changed while this operation was in flight');}
}
export class AuthRenewalError extends Error {
  override name = 'AuthRenewalError';
  constructor(cause:unknown){super('The configured token renewal failed',{cause});}
}
export class LoginRejectedError extends Error {
  override name = 'LoginRejectedError';
  constructor(message:string,readonly raw:unknown){super(message);}
}
export class LoginBootstrapError extends Error {
  override name='LoginBootstrapError';
  readonly credentialsAcquired=true;
  constructor(readonly sessionEpoch:number,cause:unknown){super('Login acquired credentials, but loading the profile failed; inspect the session before retrying login',{cause});}
}
export class IdNamespaceError extends Error {
  override name='IdNamespaceError';
  constructor(expected:string,actual:string){super(`Expected ${expected}, received ${actual}`);}
}
export class RuntimeAssociationRequiredError extends Error {
  override name='RuntimeAssociationRequiredError';
  constructor(readonly edge:string){super(`An observed runtime association is required for ${edge}`);}
}
export class ConfirmationRejectedError extends Error {
  override name='ConfirmationRejectedError';
  constructor(readonly raw:unknown,readonly status?:string){super(`Confirmation was not accepted${status?`: ${status}`:''}`);}
}
