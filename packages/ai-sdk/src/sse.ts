import { HttpError, IncompleteStreamError, ProtocolError } from './errors.js';
import { WorkModeSignalTracker } from './modes.js';
import type { AiSseEvent, ProductWorkMode, SseFrame, StreamCompletion, StreamOptions, StreamProfile, StreamTermination } from './types.js';

/** Incremental SSE framing. EOF never synthesizes a missing blank-line delimiter. */
export class SseParser {
  #buffer = '';
  #firstLine = true;
  #data: string[] = [];
  #event: string | undefined;
  #id: string | undefined;
  #retry: number | undefined;
  #size = 0;
  constructor(readonly maxFrameChars = 16 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxFrameChars) || maxFrameChars <= 0) throw new TypeError('Positive maxFrameChars required');
  }
  push(text: string): SseFrame[] {
    this.#buffer += text;
    return this.#drain(false);
  }
  finish(): SseFrame[] {
    const frames = this.#drain(true);
    this.#buffer = '';
    this.#reset();
    return frames;
  }
  #reset(): void { this.#data = []; this.#event = undefined; this.#id = undefined; this.#retry = undefined; this.#size = 0; }
  #drain(eof: boolean): SseFrame[] {
    const frames: SseFrame[] = [];
    let start = 0;
    for (let i = 0; i < this.#buffer.length; i++) {
      const char = this.#buffer[i];
      if (char !== '\n' && char !== '\r') continue;
      if (char === '\r' && i + 1 === this.#buffer.length && !eof) break;
      let line = this.#buffer.slice(start, i);
      if (char === '\r' && this.#buffer[i + 1] === '\n') i++;
      start = i + 1;
      if (this.#firstLine) { this.#firstLine = false; line = line.replace(/^\uFEFF/, ''); }
      if (!line) {
        if (this.#data.length) frames.push({data:this.#data.join('\n'),
          ...(this.#event === undefined ? {} : {event:this.#event}),
          ...(this.#id === undefined ? {} : {id:this.#id}),
          ...(this.#retry === undefined ? {} : {retry:this.#retry})});
        this.#reset();
        continue;
      }
      this.#size += line.length;
      if (this.#size > this.maxFrameChars) throw new ProtocolError('SSE frame exceeds maxFrameChars');
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const key = colon < 0 ? line : line.slice(0,colon);
      let value = colon < 0 ? '' : line.slice(colon+1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (key === 'data') this.#data.push(value);
      else if (key === 'event') this.#event = value;
      else if (key === 'id' && !value.includes('\0')) this.#id = value;
      else if (key === 'retry' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) this.#retry = Number(value);
    }
    this.#buffer = this.#buffer.slice(start);
    if (this.#size + this.#buffer.length > this.maxFrameChars) throw new ProtocolError('SSE frame exceeds maxFrameChars');
    return frames;
  }
}

export async function* readSse(body: ReadableStream<Uint8Array>, maxFrameChars?: number): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser(maxFrameChars);
  let reachedEof = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) { reachedEof = true; break; }
      for (const frame of parser.push(decoder.decode(result.value,{stream:true}))) yield frame;
    }
    for (const frame of parser.push(decoder.decode())) yield frame;
    for (const frame of parser.finish()) yield frame;
  } finally {
    if (!reachedEof) { try { await reader.cancel(); } catch { /* Already aborted. */ } }
    reader.releaseLock();
  }
}

const MAIN_PREEMPT = new Set(['delta','delta_encoding','notice','create_conversation','content_detect','title_generation','control','quick_reply','retry_reset','retry_error']);
const RECOMMEND_PREEMPT = new Set(['delta','delta_encoding','notice','recommend_condition','search_condition','create_conversation','content_detect','title_generation']);

/** Models the observed consumer branches, not just the low-level s$ helper. */
export function isAppDone(event: {event?:string;data:unknown}, profile: StreamProfile = 'main'): boolean {
  if (event.data !== '[DONE]' || profile === 'job-match') return false;
  if (profile === 'resume') return !event.event;
  return !(profile === 'recommend' ? RECOMMEND_PREEMPT : MAIN_PREEMPT).has(event.event ?? '');
}
export function decodeSseData(text: string, lineMode: 'app-last-line'|'standard' = 'app-last-line'): unknown {
  const value = (lineMode === 'app-last-line' ? text.split('\n').at(-1) ?? '' : text).trim();
  try { return JSON.parse(value); } catch { return value; }
}

export class SseSession implements AsyncIterable<AiSseEvent> {
  readonly completion: Promise<StreamCompletion>;
  readonly #abortController = new AbortController();
  readonly #request: (signal: AbortSignal) => Promise<Response>;
  readonly #options: StreamOptions;
  #resolve!: (value: StreamCompletion) => void;
  #started = false;
  #running = false;
  #settled = false;
  #removeParent = () => {};
  constructor(request: (signal:AbortSignal)=>Promise<Response>, options:StreamOptions = {}) {
    this.#request = request;
    this.#options = options;
    this.completion = new Promise(resolve=>{this.#resolve=resolve;});
    if (options.signal) {
      const parent = options.signal;
      const forward = () => this.abort(parent.reason);
      if (parent.aborted) this.#abortController.abort(parent.reason);
      else { parent.addEventListener('abort',forward,{once:true}); this.#removeParent=()=>parent.removeEventListener('abort',forward); }
    }
  }
  get signal(): AbortSignal { return this.#abortController.signal; }
  /** Local cancellation only. Never implicitly calls the server stopSay endpoint. */
  abort(reason?: unknown): void {
    this.#abortController.abort(reason);
    if (!this.#running) this.#settle({termination:'aborted',sawDone:false,eventCount:0,error:reason});
  }
  #settle(value: StreamCompletion): void {
    this.#removeParent();
    if (!this.#settled) { this.#settled = true; this.#resolve(value); }
  }
  [Symbol.asyncIterator](): AsyncIterator<AiSseEvent> {
    if (this.#started) throw new TypeError('An SSE session can only be consumed once');
    this.#started = true;
    const iterator = this.#run();
    return {
      next: () => iterator.next(),
      return: async () => {
        try { return await iterator.return(undefined); }
        finally { this.#settle({termination:'consumer_cancelled',sawDone:false,eventCount:0}); }
      },
      throw: async (error?: unknown) => {
        try { return await iterator.throw(error); }
        finally { this.#settle({termination:'error',sawDone:false,eventCount:0,error}); }
      },
    };
  }
  async *#run(): AsyncGenerator<AiSseEvent> {
    this.#running = true;
    let termination: StreamTermination = 'consumer_cancelled';
    let sawDone = false, eventCount = 0;
    let httpStatus: number | undefined, error: unknown, consumed: ProductWorkMode | undefined;
    const tracker = new WorkModeSignalTracker();
    const profile = this.#options.profile ?? 'main';
    try {
      this.signal.throwIfAborted();
      const response = await this.#request(this.signal);
      httpStatus = response.status;
      if (!response.ok) {
        const text = await response.text();
        let raw: unknown = text;
        try { raw = JSON.parse(text); } catch { /* Non-JSON HTTP error. */ }
        throw new HttpError(`SSE HTTP ${response.status}`,response.status,raw,response.headers);
      }
      if (!response.body) throw new ProtocolError('SSE response has no readable body');
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.toLowerCase().includes('text/event-stream')) {
        const raw = await response.text();
        throw new HttpError('Expected text/event-stream response',response.status,raw,response.headers);
      }
      for await (const frame of readSse(response.body,this.#options.maxFrameChars)) {
        this.signal.throwIfAborted();
        const event = frame.event === undefined ? undefined : frame.event.trim();
        const data = decodeSseData(frame.data,this.#options.dataLineMode);
        const item: AiSseEvent = {event,data,raw:frame,done:false};
        if (profile === 'main' && event === 'delta') {
          const candidate = tracker.observeDelta(data);
          if (candidate) item.workModeCandidate = candidate;
        }
        const done = this.#options.donePredicate?.({event,data}) ?? isAppDone({event,data},profile);
        item.done = done;
        if (done) {
          sawDone = true;
          termination = 'done';
          const signal = tracker.consume();
          if (signal) { item.workModeSignal = signal; consumed = signal; }
        }
        eventCount++;
        yield item;
        if (done) return;
      }
      termination = 'eof';
      if (this.#options.requireDone ?? profile !== 'job-match') throw new IncompleteStreamError();
    } catch (caught) {
      error = caught;
      termination = this.signal.aborted ? 'aborted' : caught instanceof IncompleteStreamError ? 'eof' : 'error';
      throw caught;
    } finally {
      this.#settle({termination,sawDone,eventCount,httpStatus,
        ...(error === undefined ? {} : {error}),
        ...(consumed ? {workModeSignal:consumed} : {}),
        ...(tracker.peek() ? {pendingWorkMode:tracker.peek()!} : {})});
    }
  }
}
