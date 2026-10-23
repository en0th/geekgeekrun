import type { CardModeId, ChatMessage, ModeWireId, ProductWorkMode, ProxyMode } from './types.js';

export function normalizeCardMode(value: unknown): CardModeId | null {
  if (value === 'AUTO_CHAT' || value === 'CHAT_ONLY') return 'CHAT_ONLY';
  if (value === 'DELIVERY_AFTER_CONFIRM' || value === 'CONFIRM_DELIVERY' || value === 'CONFIRM_BEFORE_CONTACT') return 'CONFIRM_BEFORE_CONTACT';
  return value === 'AUTO_DELIVERY' ? 'AUTO_DELIVERY' : null;
}
export function toProxyMode(value: ModeWireId): ProxyMode {
  const mode = normalizeCardMode(value);
  if (mode === 'CHAT_ONLY') return 'AUTO_CHAT';
  if (mode === 'CONFIRM_BEFORE_CONTACT') return 'DELIVERY_AFTER_CONFIRM';
  if (mode === 'AUTO_DELIVERY') return 'AUTO_DELIVERY';
  throw new TypeError('Unrecognized proxy mode');
}
export function normalizeProxyMode(value: unknown): ProxyMode | null {
  return value === 'AUTO_CHAT' || value === 'DELIVERY_AFTER_CONFIRM' || value === 'AUTO_DELIVERY' ? value : null;
}
export const WORK_MODE_CONTENT_TYPES = Object.freeze({
  douzi_work_mode_job_seeking: 'JOB_SEEKING',
  douzi_work_mode_market_matching: 'MARKET_WATCHING',
  data_market_matching: 'MARKET_WATCHING',
} as const);

/** Static rZe/zT/B4e counterpart; no request or cache write. */
export function detectWorkMode(message: ChatMessage): ProductWorkMode | null {
  if (!message || message.author?.role === 'user') return null;
  function walk(value: unknown, depth: number): ProductWorkMode | null {
    if (depth > 8 || value === null || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      for (const child of value) { const found = walk(child, depth + 1); if (found) return found; }
      return null;
    }
    const object = value as Record<string, unknown>;
    const contentType = String(object.content_type || '').trim();
    if (Object.hasOwn(WORK_MODE_CONTENT_TYPES, contentType)) {
      return WORK_MODE_CONTENT_TYPES[contentType as keyof typeof WORK_MODE_CONTENT_TYPES];
    }
    for (const child of Object.values(object)) { const found = walk(child, depth + 1); if (found) return found; }
    return null;
  }
  return walk(message.content, 0);
}

/** Per-stream last-wins signal only. Consuming never applies a policy automatically. */
export class WorkModeSignalTracker {
  #pending: ProductWorkMode | null = null;
  observeDelta(data: unknown): ProductWorkMode | null {
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return null; } }
    if (!data || typeof data !== 'object') return null;
    const delta = data as Record<string, unknown>;
    if (delta.o !== 'add' || !delta.v || typeof delta.v !== 'object') return null;
    const mode = detectWorkMode(delta.v as ChatMessage);
    if (mode) this.#pending = mode;
    return mode;
  }
  peek(): ProductWorkMode | null { return this.#pending; }
  consume(): ProductWorkMode | null {
    const pending = this.#pending;
    this.#pending = null;
    return pending;
  }
}
