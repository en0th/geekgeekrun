/** Open records retain fields not established by the shipped client. */
export type JsonRecord = Record<string, unknown>;
export type Id = string | number;
export type ProductWorkMode = 'JOB_SEEKING' | 'MARKET_WATCHING';
export type ProxyMode = 'AUTO_CHAT' | 'DELIVERY_AFTER_CONFIRM' | 'AUTO_DELIVERY';
export type CardModeId = 'CHAT_ONLY' | 'CONFIRM_BEFORE_CONTACT' | 'AUTO_DELIVERY';
export type ModeWireId = ProxyMode | CardModeId | 'CONFIRM_DELIVERY';
export type DeliveryMethod = 'AUTO' | 'CONFIRM';
export type MatchStrategy = 'STRICT' | 'STANDARD' | 'LOOSE';
export type DeliveryPreference = 'NEW_JOB' | 'URGENT_JOB' | 'FAST_REPLY';
export type AgentType = 'DOUZI' | 'RECOMMEND' | 'RESUME_OPTIMIZATION';

export interface ChatPart extends JsonRecord {
  content_type?: string;
  text?: string;
}
export interface ChatContent extends JsonRecord {
  content_type: string;
  parts?: ChatPart[];
}
export interface ChatMessage extends JsonRecord {
  id?: Id;
  conversation_id?: Id;
  round_id?: Id;
  author?: { role?: string; [key: string]: unknown };
  content?: ChatContent;
  metadata?: JsonRecord;
}
export interface Conversation extends JsonRecord {
  id?: Id;
  title?: string;
}
/** Context is caller supplied. It is not inferred from a card ID. */
export interface ConversationContext {
  parent?: Id;
  conversation_id?: Id;
}
export interface UserSayRequest extends JsonRecord, ConversationContext {
  content: ChatContent;
  metadata?: JsonRecord;
  author?: { role: string; [key: string]: unknown };
  agent_hint?: { conversionType: AgentType | string; conversionRelatedId?: Id; [key: string]: unknown };
  current_condition?: JsonRecord;
}
export interface RetryRequest {
  answer_message_id: Id;
  user_message_id: Id;
}
export interface WorkSettings extends JsonRecord {
  workMode?: ProductWorkMode | null;
  proxyMode?: ProxyMode | null;
  agentProxyEnabled?: boolean;
  communication?: { autoChatEnabled?: boolean; [key: string]: unknown };
  delivery?: {
    enabled?: boolean;
    method?: DeliveryMethod;
    matchStrategy?: MatchStrategy;
    preferences?: DeliveryPreference[];
    [key: string]: unknown;
  };
}
export interface DeliverySettingsInput extends JsonRecord {
  enabled: boolean;
  method: DeliveryMethod;
  matchStrategy: MatchStrategy;
  preferences: DeliveryPreference[];
}
export type QueryScalar = string | number | boolean;
export type QueryValue = QueryScalar | null | undefined | readonly (QueryScalar | null | undefined)[];
export type Query = Record<string, QueryValue>;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export interface AuthAuthorization {
  accessToken?: string;
  sessionEpoch: number;
  tokenRevision?:number;
}
export interface AuthSessionProvider {
  readonly epoch: number;
  authorize(): Promise<AuthAuthorization>;
  recoverUnauthorized(previous: AuthAuthorization): Promise<AuthAuthorization>;
  rejectAuthorization(previous: AuthAuthorization): void;
  assertCurrent(previous: AuthAuthorization): void;
  onSessionChange(listener:(epoch:number)=>void):()=>void;
}
export interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  cache?: RequestCache;
  /** App-compatible returnEnvelope: bypass business-code rejection, never HTTP/401. */
  returnEnvelope?: boolean;
  allowBusinessCodes?: readonly number[];
  /** none: public/login call, without automatic API credentials. */
  auth?: 'auto'|'none'|'required';
  /** Default: one retry for managed GET only; POST/write/SSE never auto replay. */
  retryOnUnauthorized?: boolean;
  /** Bind a multi-step operation to one managed session; changed accounts fail closed. */
  sessionEpoch?: number;
}
export interface EndpointDefinition {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly base: string;
  readonly transport: string;
  readonly category: string;
  readonly defaultQuery?: Query;
  readonly pathParams?: readonly string[];
}
export interface EndpointCallOptions extends RequestOptions {
  path?: Record<string,Id>;
  /** Override only for a documented variant of a preview/download endpoint. */
  responseType?: 'json' | 'blob' | 'text';
}
export interface ApiResult<T = unknown> {
  /** App-compatible data/result extraction; can be undefined. */
  data: T | null | undefined;
  /** Original JSON, including revisions/unknown fields removed by App normalizers. */
  raw: unknown;
  status: number;
  headers: Headers;
}
export interface SseFrame {
  /** Undefined if no event line was received; never synthesized as 'message'. */
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}
export interface AiSseEvent {
  event?: string;
  /** Data trimmed and JSON-decoded; default App mode uses the last data line. */
  data: unknown;
  raw: SseFrame;
  done: boolean;
  /** Candidate in this delta-add; not a committed configuration. */
  workModeCandidate?: ProductWorkMode;
  /** Last candidate consumed at recognized DONE; no automatic HTTP mutation. */
  workModeSignal?: ProductWorkMode;
}
export type StreamTermination = 'done' | 'eof' | 'aborted' | 'consumer_cancelled' | 'error';
export interface StreamCompletion {
  termination: StreamTermination;
  sawDone: boolean;
  eventCount: number;
  httpStatus?: number;
  error?: unknown;
  workModeSignal?: ProductWorkMode;
  pendingWorkMode?: ProductWorkMode;
}
export type StreamProfile = 'main' | 'recommend' | 'resume' | 'job-match';
export interface StreamOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
  /** Default true: EOF without recognized DONE throws IncompleteStreamError. */
  requireDone?: boolean;
  profile?: StreamProfile;
  maxFrameChars?: number;
  /** raw.data always preserves standard joining; default matches App's last-line parser. */
  dataLineMode?: 'app-last-line' | 'standard';
  /** Explicit override for a server variant not established by this build. */
  donePredicate?: (event: {event?: string; data: unknown}) => boolean;
}
