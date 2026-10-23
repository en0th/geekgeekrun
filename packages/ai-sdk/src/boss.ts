import type { ZhijueAIClient } from './client.js';
import { HttpError } from './errors.js';
import { BossProtocolError, bossId, bossInteger, createBossPresenceProtocol, createBossReadProtocol, createBossTextProtocol, decodeBossProtocol, encodeBossProtocol } from './boss-protobuf.js';
import type { BossChatProtocol, BossId, BossMessage, BossMessageRead } from './boss-protobuf.js';
import { BossMqttDecoder, encodeBossMqttConnect, encodeBossMqttControl, encodeBossMqttDisconnect, encodeBossMqttPing, encodeBossMqttPuback, encodeBossMqttPublish, encodeBossMqttSubscribe } from './boss-mqtt.js';
import type { BossMqttPacket } from './boss-mqtt.js';

export interface BossCredentials { token: string; wt2: string; zpUserId: string; productId: string; identity: number }
export interface BossHttpOptions { signal?: AbortSignal; sessionEpoch?: number }
export interface BossHttpEnvelope<T = unknown> { code: number; result: T | null; message?: string; httpStatus?: number; isGatewayError?: boolean }
export interface BossHistoryPage extends Record<string, unknown> { messageList?: unknown[]; hasMore?: boolean; minMsgId?: BossId }
export interface BossHistoryInput { userId: BossId; friendId: BossId; maxMsgId?: BossId; pageSize?: number; identity?: number; userSource?: number }
export interface BossExchangeInput { userId: BossId; friendId: BossId; requestDialogMid: BossId; exchangeType: 1 | 2 | 4; resumeId?: BossId }
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function assertLosslessJson(value: unknown, depth = 0): void {
  if (depth > 64) throw new BossProtocolError('JSON response nesting exceeds limit');
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new BossProtocolError('HTTP JSON contains an unsafe integer; require the service to return IDs as decimal strings');
  if (Array.isArray(value)) for (const item of value) assertLosslessJson(item, depth + 1);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) assertLosslessJson(item, depth + 1);
}
function payload(raw: unknown): unknown { const row = object(raw); return row ? row.result ?? row.data ?? raw : raw; }
function envelope<T>(raw: unknown): BossHttpEnvelope<T> {
  assertLosslessJson(raw);
  const row = object(raw);
  if (!row) return { code: -1, result: null, message: '响应格式异常' };
  return { code: Number(row.code ?? -1), result: (row.result ?? row.data ?? null) as T | null, ...(row.message !== undefined || row.msg !== undefined ? { message: String(row.message ?? row.msg) } : {}) };
}
function successfulPayload(raw: unknown): unknown {
  assertLosslessJson(raw);
  const row = object(raw), code = row?.code;
  if (code !== undefined && ![0, 200, 4].includes(Number(code))) throw new BossProtocolError(String(row?.message ?? row?.msg ?? `BOSS HTTP business code ${String(code)}`));
  return payload(raw);
}
function httpId(value: BossId): number | string {
  const id = bossId(value), n = BigInt(id);
  // Safe values retain the observed JSON-number representation. Larger values
  // remain strings; actual server acceptance of string IDs is not established.
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : id;
}
function integerOption(value: number, name: string, min = 0, max = 2147483647): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new BossProtocolError(`Invalid ${name}`);
  return value;
}
/** App-origin HTTP only. No method is an arbitrary BOSS text-send endpoint. */
export class BossHttpClient {
  constructor(readonly client: ZhijueAIClient) {}
  async getCredentials(options: BossHttpOptions & { forceRefresh?: boolean } = {}): Promise<BossCredentials> {
    const query = { forceRefresh: options.forceRefresh ?? false };
    const { signal, sessionEpoch } = options;
    const [tokenResult, ticketResult] = await Promise.all([
      this.client.request('GET', '/wapi/user/auth/zp/chat/token/h5', { query, signal, sessionEpoch, returnEnvelope: true }),
      this.client.request('GET', '/wapi/user/auth/zp/chat/ticket/h5', { query, signal, sessionEpoch, returnEnvelope: true })
    ]);
    const tokenRow = object(successfulPayload(tokenResult.raw)), ticketRow = object(successfulPayload(ticketResult.raw));
    const token = String(tokenRow?.token ?? ''), wt2 = String(ticketRow?.webTicket2 ?? ''), productId = String(ticketRow?.productId ?? '');
    if (!token || !wt2 || tokenRow?.userId === undefined) throw new BossProtocolError('直聘 IM 凭证不完整');
    const zpUserId = bossId(tokenRow.userId as BossId);
    return { token, wt2, zpUserId, productId, identity: 0 };
  }
  async history(input: BossHistoryInput, options: BossHttpOptions = {}): Promise<BossHttpEnvelope<BossHistoryPage>> {
    const body: Record<string, unknown> = { userId: httpId(input.userId), friendId: httpId(input.friendId), identity: integerOption(input.identity ?? 0, 'identity'), userSource: integerOption(input.userSource ?? 0, 'userSource'), friendSource: 0, pageSize: integerOption(input.pageSize ?? 10, 'pageSize', 1) };
    if (input.maxMsgId !== undefined && bossInteger(input.maxMsgId) > 0n) body.maxMsgId = httpId(input.maxMsgId);
    try {
      const result = await this.client.request('POST', '/wapi/chat/history', { body, signal: options.signal, sessionEpoch: options.sessionEpoch, returnEnvelope: true, allowBusinessCodes: [1000], headers: { 'Content-Type': 'application/json;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/plain, */*' } });
      return envelope<BossHistoryPage>(result.raw);
    } catch (error) {
      if (error instanceof HttpError && [502, 503, 504].includes(error.status)) return { code: -1, result: null, message: `聊天服务暂不可用(${error.status})`, httpStatus: error.status, isGatewayError: true };
      throw error;
    }
  }
  async message(messageId: BossId, options: BossHttpOptions = {}): Promise<BossHttpEnvelope> {
    const result = await this.client.request('GET', '/wapi/chat/message', { query: { messageId: httpId(messageId), identity: 0 }, signal: options.signal, sessionEpoch: options.sessionEpoch, returnEnvelope: true });
    return envelope(result.raw);
  }
  async deliveryRecords(input: { deliveryBy?: 'MANUAL' | 'AUTO'; deliveryStatus?: 'ADD_FRIEND' | 'DELIVERED' | 'ADD_FRIEND,DELIVERED'; viewed?: boolean } = {}, options: BossHttpOptions = {}): Promise<Record<string, unknown>[]> {
    const query = { deliveryStatus: input.deliveryStatus ?? 'ADD_FRIEND,DELIVERED', ...(input.deliveryBy ? { deliveryBy: input.deliveryBy } : {}), ...(input.viewed !== undefined ? { viewed: input.viewed } : {}) };
    const response = await this.client.request('GET', '/wapi/user/geek/delivery/list', { query, signal: options.signal, sessionEpoch: options.sessionEpoch, returnEnvelope: true });
    const value = successfulPayload(response.raw);
    if (!Array.isArray(value)) throw new BossProtocolError('Expected delivery record array');
    return value.map(row => { const record = object(row); if (!record) throw new BossProtocolError('Invalid delivery record'); return record; });
  }
  async lookupDeliveryJobs(ids: readonly BossId[], options: BossHttpOptions & { includeDeleted?: boolean } = {}): Promise<Record<string, unknown>[]> {
    if (!ids.length) throw new BossProtocolError('At least one job ID is required');
    const unique = [...new Set(ids.map(id => bossId(id)))];
    const response = await this.client.request('POST', '/wapi/user/geek/delivery/listByJobIds', { body: { ids: unique.map(httpId), includeDeleted: options.includeDeleted ?? true }, headers: { 'Content-Type': 'application/json' }, signal: options.signal, sessionEpoch: options.sessionEpoch, returnEnvelope: true });
    const value = successfulPayload(response.raw);
    const rows = Array.isArray(value) ? value : object(value)?.result;
    if (!Array.isArray(rows)) throw new BossProtocolError('Expected delivery lookup result array');
    return rows.map(row => { const record = object(row); if (!record) throw new BossProtocolError('Invalid delivery record'); return record; });
  }
  /** Independent lookup after delivery. No pending-result-ID -> peer shortcut. */
  async resolvePeer(input: { friendId?: BossId; jobId?: BossId }, options: BossHttpOptions = {}): Promise<{ friendId: string; jobId?: string; record?: Record<string, unknown> }> {
    let friendId = input.friendId === undefined ? undefined : bossId(input.friendId);
    const jobId = input.jobId === undefined ? undefined : bossId(input.jobId);
    let record: Record<string, unknown> | undefined;
    if (jobId) {
      [record] = await this.lookupDeliveryJobs([jobId], { ...options, includeDeleted: true });
      const snapshot = object(record?.jobSnapshot), candidate = snapshot?.bossId ?? record?.zpBossUid;
      if (candidate !== undefined && candidate !== null && bossInteger(candidate as BossId) > 0n) friendId = bossId(candidate as BossId);
    }
    if (!friendId) throw new BossProtocolError('No BOSS peer UID was available from the route or delivery lookup');
    return { friendId, ...(jobId ? { jobId } : {}), ...(record ? { record } : {}) };
  }
  async hasWechat(options: BossHttpOptions = {}): Promise<BossHttpEnvelope> {
    const result = await this.client.request('GET', '/wapi/user/auth/zp/hasWechat', { signal: options.signal, sessionEpoch: options.sessionEpoch, returnEnvelope: true }); return envelope(result.raw);
  }
  async resumeAttachments(options: BossHttpOptions = {}): Promise<BossHttpEnvelope<unknown[]>> {
    const result = await this.client.request('POST', '/wapi/user/geek/resume/attachment/list', { signal: options.signal, sessionEpoch: options.sessionEpoch, returnEnvelope: true }); return envelope<unknown[]>(result.raw);
  }
  async acceptExchange(input: BossExchangeInput, options: BossHttpOptions = {}): Promise<BossHttpEnvelope> { return this.#exchange('accept', input, options); }
  async rejectExchange(input: Omit<BossExchangeInput, 'resumeId'>, options: BossHttpOptions = {}): Promise<BossHttpEnvelope> { return this.#exchange('reject', input, options); }
  async #exchange(action: 'accept' | 'reject', input: BossExchangeInput, options: BossHttpOptions): Promise<BossHttpEnvelope> {
    if (![1, 2, 4].includes(input.exchangeType)) throw new BossProtocolError('Unsupported exchange type');
    const body: Record<string, unknown> = { userId: httpId(input.userId), identity: 0, userSource: 0, friendId: httpId(input.friendId), friendSource: 0, exchangeType: input.exchangeType, requestDialogMid: httpId(input.requestDialogMid) };
    if (action === 'accept' && input.exchangeType === 4) {
      if (input.resumeId === undefined) throw new BossProtocolError('Resume exchange requires the selected attachment sourceId');
      const resumeId = input.resumeId;
      if (typeof resumeId === 'string' ? !resumeId : typeof resumeId === 'number' ? !Number.isSafeInteger(resumeId) || resumeId <= 0 : resumeId <= 0n) throw new BossProtocolError('Invalid attachment sourceId');
      // sourceId is an opaque selected attachment value in the app, not a
      // proven BOSS uid. Preserve a string without numeric coercion.
      body.extendJson = JSON.stringify({ resumeId: typeof resumeId === 'bigint' ? resumeId.toString() : resumeId });
    }
    const result = await this.client.request('POST', `/wapi/chat/exchange/${action}`, { body, signal: options.signal, sessionEpoch: options.sessionEpoch, returnEnvelope: true }); return envelope(result.raw);
  }
}

export interface BossSocket {
  send(data: Uint8Array): void | Promise<void>;
  close(): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: unknown) => void): void;
  onError(listener: (error: unknown) => void): void;
  onClose(listener: (event?: unknown) => void): void;
}
export interface BossSocketOptions { protocols: readonly ['mqtt']; headers: Readonly<{ wt: string; wt2: string; zp_product_id: string }> }
/** The adapter must implement the supplied subprotocol/headers, or reject.
 * Standard browser WebSocket cannot supply these custom headers by itself.
 */
export type BossWebSocketFactory = (url: string, options: BossSocketOptions) => BossSocket;
export type BossImState = 'disconnected' | 'connecting' | 'connected';
export interface BossBrokerReceipt { state: 'broker_received'; packetId: number; cmid?: string; extended: boolean }
export interface BossDeliveryAck { state: 'brokerAck'; packetId: number; cmid: string; mid: string }
export interface BossReadReceipt { state: 'read'; cmid: string; mid: string; receipt: BossMessageRead }
export interface BossSendHandle {
  state: 'queued'; packetId: number; cmid: string;
  brokerReceived: Promise<BossBrokerReceipt>;
  /** Resolves only for the validated 18-byte extension, never a standard ACK. */
  brokerAck: Promise<BossDeliveryAck>;
  read: Promise<BossReadReceipt>;
}
export interface BossImEvents {
  state: BossImState; error: Error; protocol: BossChatProtocol; message: BossMessage; read: BossMessageRead;
  receipt: { state: 'queued'; packetId: number; cmid: string } | BossBrokerReceipt | BossDeliveryAck | BossReadReceipt;
  unmatchedAck: Extract<BossMqttPacket, { type: 'puback' }>;
}
export interface BossImOptions {
  credentials: BossCredentials; webSocketFactory: BossWebSocketFactory;
  endpoint?: string; clientId?: string; keepAliveSeconds?: number;
  connectTimeoutMs?: number; ackTimeoutMs?: number; readTimeoutMs?: number;
  maxPacketBytes?: number; maxPendingMessages?: number;
  autoPresence?: boolean; now?: () => number;
}
export class BossConnectionError extends BossProtocolError {
  constructor(message: string, readonly connackCode?: number) { super(message); this.name = 'BossConnectionError'; }
}
export class BossAckTimeoutError extends BossProtocolError {
  constructor(readonly packetId: number, readonly cmid: string | undefined, readonly brokerReceived: boolean) { super(brokerReceived ? 'Broker ACK lacked a validated cmid/server-mid delivery extension' : 'BOSS message acknowledgment timed out'); this.name = 'BossAckTimeoutError'; }
}
interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  // A caller may choose only one receipt layer. Rejections remain observable
  // when awaited, without producing an unrelated unhandled rejection.
  void promise.catch(() => undefined); return { promise, resolve, reject };
}
interface Pending {
  packetId: number; received: Deferred<BossBrokerReceipt>; timer: ReturnType<typeof setTimeout>; brokerReceived: boolean;
  text?: TextPending;
}
interface TextPending {
  cmid: string; peer: string; source: number; ack: Deferred<BossDeliveryAck>; read: Deferred<BossReadReceipt>;
  mid?: string; readTimer?: ReturnType<typeof setTimeout>;
}
function asError(error: unknown): Error { return error instanceof Error ? error : new BossConnectionError('BOSS socket operation failed'); }
async function socketBytes(value: unknown): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof Blob !== 'undefined' && value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  throw new BossProtocolError('BOSS WebSocket requires binary MQTT data');
}
/** Explicit connection and explicit sends. No offline write queue, automatic
 * reconnection, token refresh, persistent credentials, or automatic write replay.
 */
export class BossImClient {
  readonly #options: BossImOptions;
  readonly #decoder: BossMqttDecoder;
  readonly #listeners = new Map<keyof BossImEvents, Set<(event: unknown) => void>>();
  readonly #pending = new Map<number, Pending>();
  readonly #texts = new Map<string, TextPending>();
  readonly #used = new Set<number>();
  readonly #subscriptions = new Set<number>();
  readonly #qos2 = new Map<number, Extract<BossMqttPacket, { type: 'publish' }>>();
  readonly #seen = new Map<string, true>();
  readonly #latestRead = new Map<string, BossMessageRead>();
  #state: BossImState = 'disconnected';
  #socket?: BossSocket;
  #generation = 0;
  #connectDeferred?: Deferred<void>;
  #connectTimer?: ReturnType<typeof setTimeout>;
  #pingTimer?: ReturnType<typeof setTimeout>;
  #pingResponseTimer?: ReturnType<typeof setTimeout>;
  #awaitingPing = false;
  #packetId = 1;
  #lastMid = 0n;
  #lastCmid = 0n;
  #receiveChain: Promise<void> = Promise.resolve();
  constructor(options: BossImOptions) {
    if (!options.credentials.token || !options.credentials.wt2) throw new BossProtocolError('ZP token and wt2 are required');
    bossId(options.credentials.zpUserId);
    integerOption(options.credentials.identity, 'identity');
    integerOption(options.keepAliveSeconds ?? 25, 'keepAliveSeconds', 0, 65535);
    for (const [name, value] of [['connectTimeoutMs', options.connectTimeoutMs ?? 60000], ['ackTimeoutMs', options.ackTimeoutMs ?? 60000], ['readTimeoutMs', options.readTimeoutMs ?? 0]] as const) integerOption(value, name, name === 'readTimeoutMs' ? 0 : 1);
    integerOption(options.maxPendingMessages ?? 1000, 'maxPendingMessages', 1, 65535);
    this.#options = Object.freeze({...options,credentials:Object.freeze({...options.credentials,zpUserId:bossId(options.credentials.zpUserId)})});
    this.#decoder = new BossMqttDecoder(options.maxPacketBytes);
  }
  get state(): BossImState { return this.#state; }
  on<K extends keyof BossImEvents>(event: K, listener: (value: BossImEvents[K]) => void): () => void {
    let set = this.#listeners.get(event); if (!set) { set = new Set(); this.#listeners.set(event, set); }
    const erased = listener as (value: unknown) => void; set.add(erased); return () => { set?.delete(erased); };
  }
  #emit<K extends keyof BossImEvents>(event: K, value: BossImEvents[K]): void {
    for (const listener of this.#listeners.get(event) ?? []) { try { listener(value); } catch { /* Subscriber errors do not corrupt wire state. */ } }
  }
  #setState(state: BossImState): void { if (state !== this.#state) { this.#state = state; this.#emit('state', state); } }
  #now(): number { return integerOption((this.#options.now ?? Date.now)(), 'clock', 0, Number.MAX_SAFE_INTEGER); }
  connect(): Promise<void> {
    if (this.#state === 'connected') return Promise.resolve();
    if (this.#connectDeferred) return this.#connectDeferred.promise;
    const ready = deferred<void>(); this.#connectDeferred = ready;
    const generation = ++this.#generation;
    try {
      const { credentials } = this.#options;
      if (this.#options.autoPresence !== false) encodeBossProtocol(createBossPresenceProtocol(credentials.zpUserId, this.#lastMid));
      const url = new URL(this.#options.endpoint ?? 'wss://ws6.zhipin.com/chatws');
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) throw new BossProtocolError('Invalid BOSS WebSocket endpoint');
      url.searchParams.set('wt', credentials.wt2); url.searchParams.set('zp_product_id', credentials.productId);
      this.#decoder.reset(); this.#awaitingPing = false; this.#receiveChain = Promise.resolve(); this.#setState('connecting');
      if(generation!==this.#generation||this.#state!=='connecting')return ready.promise;
      const socket = this.#options.webSocketFactory(url.toString(), { protocols: ['mqtt'], headers: { wt: credentials.wt2, wt2: credentials.wt2, zp_product_id: credentials.productId } });
      if(generation!==this.#generation||this.#state!=='connecting'){try{socket.close();}catch{}return ready.promise;}
      this.#socket = socket;
      this.#connectTimer = setTimeout(() => { if (generation === this.#generation) this.#fail(new BossConnectionError('BOSS CONNACK timeout')); }, this.#options.connectTimeoutMs ?? 60000);
      socket.onOpen(() => {
        if (generation !== this.#generation) return;
        try {
          const clientId = this.#options.clientId ?? `dhh5-${Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
          this.#write(encodeBossMqttConnect({ clientId, username: `${credentials.token}|${credentials.identity}`, password: credentials.wt2, keepAlive: this.#options.keepAliveSeconds ?? 25 }), false);
        } catch (error) { this.#fail(asError(error)); }
      });
      socket.onMessage(data => {
        if(generation!==this.#generation)return;
        this.#receiveChain = this.#receiveChain.then(async () => {
          if(generation!==this.#generation)return;
          const bytes = await socketBytes(data); if (generation !== this.#generation) return;
          for (const packet of this.#decoder.push(bytes)) { if (generation !== this.#generation) break; this.#handlePacket(packet); }
        }).catch(error => { if (generation === this.#generation) this.#fail(asError(error)); });
      });
      socket.onError(() => { if (generation === this.#generation) this.#fail(new BossConnectionError('BOSS WebSocket error')); });
      socket.onClose(() => { if (generation === this.#generation) this.#fail(new BossConnectionError('BOSS WebSocket closed')); });
    } catch (error) { if(generation===this.#generation)this.#fail(asError(error));else ready.reject(error); }
    return ready.promise;
  }
  #nextPacketId(): number {
    for (let i = 0; i < 65535; i++) {
      const id = this.#packetId; this.#packetId = id === 65535 ? 1 : id + 1;
      if (!this.#used.has(id)) { this.#used.add(id); return id; }
    }
    throw new BossProtocolError('No MQTT packet identifiers available');
  }
  #armPing(): void {
    if (this.#pingTimer) clearTimeout(this.#pingTimer);
    const seconds = this.#options.keepAliveSeconds ?? 25;
    if (!seconds || this.#state !== 'connected' || this.#awaitingPing) return;
    this.#pingTimer = setTimeout(() => {
      if (this.#state !== 'connected') return;
      this.#awaitingPing = true;
      this.#pingResponseTimer = setTimeout(() => { if (this.#awaitingPing) this.#fail(new BossConnectionError('BOSS PINGRESP timeout')); }, seconds * 1000);
      try { this.#write(encodeBossMqttPing()); } catch (error) { this.#fail(asError(error)); }
    }, seconds * 1000);
  }
  #write(bytes: Uint8Array, connected = true): void {
    if (!this.#socket || (connected && this.#state !== 'connected')) throw new BossConnectionError('Await connect() and CONNACK before sending');
    const generation = this.#generation, result = this.#socket.send(bytes);
    if (result && typeof result.then === 'function') void result.catch(error => { if (generation === this.#generation) this.#fail(asError(error)); });
    if (connected) this.#armPing();
  }
  #releasePending(pending: Pending): void { clearTimeout(pending.timer); this.#pending.delete(pending.packetId); this.#used.delete(pending.packetId); }
  #rejectText(text: TextPending, error: Error): void {
    if (text.readTimer) clearTimeout(text.readTimer);
    text.ack.reject(error); text.read.reject(error); this.#texts.delete(text.cmid);
  }
  #publish(protocol: BossChatProtocol, text?: TextPending): { packetId: number; received: Deferred<BossBrokerReceipt> } {
    if (this.#state !== 'connected') throw new BossConnectionError('Await connect() and CONNACK before sending');
    const encoded = encodeBossProtocol(protocol), packetId = this.#nextPacketId(), received = deferred<BossBrokerReceipt>();
    const pending: Pending = { packetId, received, brokerReceived: false, text, timer: setTimeout(() => {
      const current = this.#pending.get(packetId); if (current !== pending) return;
      const error = new BossAckTimeoutError(packetId, text?.cmid, pending.brokerReceived);
      this.#releasePending(pending); received.reject(error); if (text) this.#rejectText(text, error); this.#emit('error', error);
    }, this.#options.ackTimeoutMs ?? 60000) };
    this.#pending.set(packetId, pending);
    try { this.#write(encodeBossMqttPublish({ packetId, payload: encoded, qos: 1, retained: true })); }
    catch (error) { this.#releasePending(pending); received.reject(error); if (text) this.#rejectText(text, asError(error)); throw error; }
    return { packetId, received };
  }
  sendText(input: { to: BossId; text: string; cmid?: BossId; friendSource?: number; encryptUid?: string }): BossSendHandle {
    if (this.#state !== 'connected') throw new BossConnectionError('Await connect() and CONNACK before sending');
    const text = input.text.trim(); if (!text) throw new BossProtocolError('Message text cannot be empty');
    if (this.#texts.size >= (this.#options.maxPendingMessages ?? 1000)) throw new BossProtocolError('Pending message/read limit reached');
    const clock=BigInt(this.#now());
    let generated=this.#lastMid+clock;
    if(generated>0x7fffffffffffffffn)generated=clock;
    if(generated<=this.#lastCmid)generated=this.#lastCmid+1n;
    const cmid = bossId(input.cmid ?? generated), peer = bossId(input.to), source = integerOption(input.friendSource ?? 0, 'friendSource');
    if (this.#texts.has(cmid)) throw new BossProtocolError('Duplicate pending cmid');
    const pending: TextPending = { cmid, peer, source, ack: deferred<BossDeliveryAck>(), read: deferred<BossReadReceipt>() };
    const protocol = createBossTextProtocol({ from: this.#options.credentials.zpUserId, to: peer, cmid, text, time: this.#now(), friendSource: source, ...(input.encryptUid ? { encryptUid: input.encryptUid } : {}) });
    // Validate before registering a read wait so malformed IDs cannot leak one.
    encodeBossProtocol(protocol); this.#lastCmid=BigInt(cmid)>this.#lastCmid?BigInt(cmid):this.#lastCmid;this.#texts.set(cmid, pending);
    let queued: { packetId: number; received: Deferred<BossBrokerReceipt> };
    try { queued = this.#publish(protocol, pending); }
    catch (error) { this.#rejectText(pending, asError(error)); throw error; }
    this.#emit('receipt', { state: 'queued', packetId: queued.packetId, cmid });
    return { state: 'queued', packetId: queued.packetId, cmid, brokerReceived: queued.received.promise, brokerAck: pending.ack.promise, read: pending.read.promise };
  }
  sendRead(input: { userId: BossId; messageId: BossId; userSource?: number }): Promise<BossBrokerReceipt> {
    return this.#publish(createBossReadProtocol({ ...input, readTime: this.#now() })).received.promise;
  }
  #handlePacket(packet: BossMqttPacket): void {
    if (packet.type === 'connack') {
      if (this.#state !== 'connecting') throw new BossProtocolError('Unexpected CONNACK');
      if (packet.returnCode !== 0) { this.#fail(new BossConnectionError(`BOSS CONNACK rejected (${packet.returnCode})`, packet.returnCode)); return; }
      if (this.#connectTimer) clearTimeout(this.#connectTimer); this.#connectTimer = undefined;
      const generation=this.#generation;this.#setState('connected');
      if(generation!==this.#generation||this.state!=='connected')return;
      const subscription = this.#nextPacketId(); this.#subscriptions.add(subscription);
      this.#write(encodeBossMqttSubscribe(subscription));
      if (this.#options.autoPresence !== false) void this.#publish(createBossPresenceProtocol(this.#options.credentials.zpUserId, this.#lastMid)).received.promise;
      this.#connectDeferred?.resolve(); this.#connectDeferred = undefined; this.#armPing(); return;
    }
    if (this.#state !== 'connected') throw new BossProtocolError('Received MQTT application packet before CONNACK');
    if (packet.type === 'puback') { this.#handleAck(packet); return; }
    if (packet.type === 'suback') {
      if (!this.#subscriptions.has(packet.packetId)) throw new BossProtocolError('Unmatched SUBACK');
      this.#subscriptions.delete(packet.packetId); this.#used.delete(packet.packetId);
      if (packet.returnCodes.some(code => code === 128 || code > 2)) throw new BossProtocolError('BOSS chat subscription rejected'); return;
    }
    if (packet.type === 'pingresp') { if (this.#pingResponseTimer) clearTimeout(this.#pingResponseTimer); this.#pingResponseTimer = undefined; this.#awaitingPing = false; this.#armPing(); return; }
    if (packet.type === 'publish') {
      if (packet.qos === 1) this.#write(encodeBossMqttPuback(packet.packetId!));
      else if (packet.qos === 2) { this.#qos2.set(packet.packetId!, packet); this.#write(encodeBossMqttControl('pubrec', packet.packetId!)); return; }
      this.#receivePublish(packet); return;
    }
    if (packet.type === 'pubrel') {
      const publish = this.#qos2.get(packet.packetId); this.#qos2.delete(packet.packetId);
      if (publish) this.#receivePublish(publish); this.#write(encodeBossMqttControl('pubcomp', packet.packetId)); return;
    }
    if (packet.type === 'disconnect') { this.#fail(new BossConnectionError('BOSS broker disconnected')); return; }
    throw new BossProtocolError(`Unsupported inbound MQTT packet ${packet.type}`);
  }
  #handleAck(packet: Extract<BossMqttPacket, { type: 'puback' }>): void {
    const generation=this.#generation;
    const pending = this.#pending.get(packet.packetId);
    if (!pending) { this.#emit('unmatchedAck', packet); return; }
    const receipt: BossBrokerReceipt = { state: 'broker_received', packetId: packet.packetId, extended: packet.extended, ...(pending.text ? { cmid: pending.text.cmid } : {}) };
    pending.brokerReceived = true; pending.received.resolve(receipt); this.#emit('receipt', receipt);
    if(generation!==this.#generation)return;
    const text = pending.text;
    if (!text) { this.#releasePending(pending); return; }
    // A plain MQTT ACK is not the business delivery extension. Keep its logical
    // packet reservation until extension/timeout so a late ACK cannot bind anew.
    if (!packet.extended) return;
    if (!packet.cmid || packet.cmid === '0' || !packet.mid || packet.mid === '0' || packet.cmid !== text.cmid) {
      const error = new BossProtocolError('Extended PUBACK did not match packetId + original cmid + nonzero server mid');
      this.#releasePending(pending); this.#rejectText(text, error); this.#emit('error', error); return;
    }
    this.#releasePending(pending); text.mid = packet.mid;
    // ACK uses uint64 while the protobuf send/presence cursor is int64. Keep the
    // raw receipt lossless without poisoning future signed client ID allocation.
    if (BigInt(packet.mid) <= 0x7fffffffffffffffn && BigInt(packet.mid) > this.#lastMid) this.#lastMid = BigInt(packet.mid);
    const ack: BossDeliveryAck = { state: 'brokerAck', packetId: packet.packetId, cmid: packet.cmid, mid: packet.mid };
    text.ack.resolve(ack); this.#emit('receipt', ack);
    if(generation!==this.#generation)return;
    const timeout = this.#options.readTimeoutMs ?? 0;
    if (timeout > 0) text.readTimer = setTimeout(() => { const error = new BossProtocolError('BOSS read receipt timed out'); this.#rejectText(text, error); }, timeout);
    const read = this.#latestRead.get(`${text.peer}:${text.source}`); if (read) this.#applyRead(text, read);
  }
  #seenBefore(key: string): boolean {
    if (this.#seen.has(key)) return true;
    this.#seen.set(key, true); if (this.#seen.size > 10000) this.#seen.delete(this.#seen.keys().next().value!); return false;
  }
  #receivePublish(packet: Extract<BossMqttPacket, { type: 'publish' }>): void {
    if (packet.topic !== 'chat') throw new BossProtocolError('Unexpected BOSS MQTT topic');
    const generation=this.#generation,protocol = decodeBossProtocol(packet.payload); this.#emit('protocol', protocol);
    if(generation!==this.#generation)return;
    if (protocol.type === 1) for (const message of protocol.messages ?? []) {
      if (message.mid && BigInt(message.mid) > this.#lastMid) this.#lastMid = BigInt(message.mid);
      if (!message.mid || !this.#seenBefore(`message:${message.mid}`)) this.#emit('message', message);
      if(generation!==this.#generation)return;
    }
    if (protocol.type === 6) for (const read of protocol.messageRead ?? []) {
      if (this.#seenBefore(`read:${read.userId}:${read.userSource ?? 0}:${read.messageId}:${read.sync ?? false}`)) continue;
      this.#emit('read', read);
      if(generation!==this.#generation)return;
      if (read.sync) continue;
      const key = `${read.userId}:${read.userSource ?? 0}`, previous = this.#latestRead.get(key);
      if (!previous || BigInt(read.messageId) > BigInt(previous.messageId)) this.#latestRead.set(key, read);
      if (this.#latestRead.size > 10000) this.#latestRead.delete(this.#latestRead.keys().next().value!);
      for (const text of this.#texts.values()) this.#applyRead(text, read);
    }
  }
  #applyRead(text: TextPending, read: BossMessageRead): void {
    if (read.sync || !text.mid || text.peer !== read.userId || text.source !== (read.userSource ?? 0) || BigInt(text.mid) > BigInt(read.messageId)) return;
    const result: BossReadReceipt = { state: 'read', cmid: text.cmid, mid: text.mid, receipt: read };
    if (text.readTimer) clearTimeout(text.readTimer); text.read.resolve(result); this.#texts.delete(text.cmid); this.#emit('receipt', result);
  }
  #fail(error: Error): void {
    ++this.#generation;
    if (this.#connectTimer) clearTimeout(this.#connectTimer); if (this.#pingTimer) clearTimeout(this.#pingTimer); if (this.#pingResponseTimer) clearTimeout(this.#pingResponseTimer);
    this.#connectTimer = undefined; this.#pingTimer = undefined; this.#pingResponseTimer = undefined; this.#awaitingPing = false;
    this.#connectDeferred?.reject(error); this.#connectDeferred = undefined;
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.received.reject(error); if (pending.text) this.#rejectText(pending.text, error); }
    for (const text of this.#texts.values()) this.#rejectText(text, error);
    this.#pending.clear(); this.#texts.clear(); this.#used.clear(); this.#subscriptions.clear(); this.#qos2.clear();
    const socket = this.#socket; this.#socket = undefined; this.#decoder.reset(); this.#setState('disconnected');
    try { socket?.close(); } catch { /* Local cleanup is complete. */ }
    this.#emit('error', error);
  }
  disconnect(): void {
    if (this.#state === 'connected') { try { this.#write(encodeBossMqttDisconnect()); } catch { /* Still close locally. */ } }
    this.#fail(new BossConnectionError('BOSS client disconnected explicitly'));
  }
}
