import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BossWebSocketFactory } from "@recovered/zhijue-ai-sdk";
export interface BridgeEvent {
  id: string;
  kind: string;
  status?: number;
  headers?: Record<string, string>;
  data?: string;
  message?: string;
}
export interface NativeBridge {
  addListener(
    name: "network" | "socket",
    listener: (event: BridgeEvent) => void,
  ): Promise<{ remove(): Promise<void> }>;
  request(
    options: Record<string, unknown>,
  ): Promise<{ status: number; headers: Record<string, string>; data: string }>;
  stream(options: Record<string, unknown>): Promise<void>;
  cancel(options: { id: string }): Promise<void>;
  openSocket(options: Record<string, unknown>): Promise<void>;
  sendSocket(options: { id: string; data: string }): Promise<void>;
  closeSocket(options: { id: string }): Promise<void>;
  readSession(): Promise<{ value?: string }>;
  writeSession(options: { value: string }): Promise<void>;
  clearSession(): Promise<void>;
}
export const MobileBridge = registerPlugin<NativeBridge>("MobileBridge");
export const isNative = () => Capacitor.isNativePlatform();
export function toBase64(bytes: Uint8Array): string {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
const abortError = () => new DOMException("请求已取消", "AbortError");
const cancel = (bridge: NativeBridge, id: string) => {
  void bridge.cancel({ id }).catch(() => {});
};
interface StreamEntry {
  controller: ReadableStreamDefaultController<Uint8Array>;
  body: ReadableStream<Uint8Array>;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
  ready: boolean;
}
/** Fetch subset used by the SDK: URL + JSON/string/FormData, no ambient cookies. */
export function createNativeFetch(bridge: NativeBridge): typeof fetch {
  const streams = new Map<string, StreamEntry>();
  function fail(id: string, error: unknown) {
    const entry = streams.get(id);
    if (!entry) return;
    entry.reject(error);
    try {
      entry.controller.error(error);
    } catch {}
    entry.cleanup();
    streams.delete(id);
  }
  const listener = bridge.addListener("network", (event) => {
    const entry = streams.get(event.id);
    if (!entry) return;
    try {
      if (event.kind === "headers") {
        if (entry.ready) throw new Error("Duplicate response headers");
        entry.ready = true;
        entry.resolve(
          new Response(
            event.status === 204 || event.status === 205 ? null : entry.body,
            { status: event.status ?? 200, headers: event.headers },
          ),
        );
      } else if (event.kind === "chunk") {
        if (!entry.ready) throw new Error("Response chunk preceded headers");
        entry.controller.enqueue(fromBase64(event.data ?? ""));
      } else if (event.kind === "end") {
        if (!entry.ready) throw new Error("Response ended before headers");
        entry.controller.close();
        entry.cleanup();
        streams.delete(event.id);
      } else if (event.kind === "error")
        fail(event.id, new Error("连接已中断"));
    } catch (error) {
      fail(event.id, error);
      cancel(bridge, event.id);
    }
  });
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (typeof input !== "string" && !(input instanceof URL))
      throw new TypeError("SDK transport requires a URL and explicit init");
    const url = new URL(String(input));
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new TypeError("服务地址必须使用HTTPS");
    init.signal?.throwIfAborted();
    const headers = Object.fromEntries(new Headers(init.headers));
    const method = (init.method ?? "GET").toUpperCase();
    const id = crypto.randomUUID();
    const options: Record<string, unknown> = {
      id,
      url: url.toString(),
      method,
      headers,
    };
    if (init.body instanceof FormData) {
      const parts = [];
      for (const [name, value] of init.body.entries())
        parts.push(
          typeof value === "string"
            ? { name, value }
            : {
                name,
                filename: value.name,
                mimeType: value.type,
                data: toBase64(new Uint8Array(await value.arrayBuffer())),
              },
        );
      options.parts = parts;
    } else if (init.body !== undefined && init.body !== null) {
      if (typeof init.body !== "string")
        throw new TypeError("Unsupported request body");
      options.body = init.body;
    }
    init.signal?.throwIfAborted();
    if (!String(headers.accept ?? "").includes("text/event-stream")) {
      let rejectAbort!: (error: unknown) => void;
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = reject;
      });
      const abort = () => {
        cancel(bridge, id);
        rejectAbort(init.signal?.reason ?? abortError());
      };
      init.signal?.addEventListener("abort", abort, { once: true });
      try {
        if (init.signal?.aborted) {
          abort();
          return await aborted;
        }
        const result = await Promise.race([bridge.request(options), aborted]);
        init.signal?.throwIfAborted();
        return new Response(
          result.status === 204 ||
          result.status === 205 ||
          result.status === 304 ||
          method === "HEAD"
            ? null
            : new Uint8Array(fromBase64(result.data)).buffer,
          { status: result.status, headers: result.headers },
        );
      } finally {
        init.signal?.removeEventListener("abort", abort);
      }
    }
    await listener;
    init.signal?.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const abort = () => {
        fail(id, init.signal?.reason ?? abortError());
        cancel(bridge, id);
      };
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
        cancel() {
          streams.get(id)?.cleanup();
          streams.delete(id);
          cancel(bridge, id);
        },
      });
      streams.set(id, {
        controller,
        body,
        resolve,
        reject,
        ready: false,
        cleanup: () => init.signal?.removeEventListener("abort", abort),
      });
      init.signal?.addEventListener("abort", abort, { once: true });
      if (init.signal?.aborted) {
        abort();
        return;
      }
      void bridge.stream(options).catch((error) => fail(id, error));
    });
  }) as typeof fetch;
}
export function createNativeBossFactory(
  bridge: NativeBridge,
): BossWebSocketFactory {
  const sockets = new Map<
    string,
    {
      open: () => void;
      message: (data: unknown) => void;
      error: (error: unknown) => void;
      close: (event?: unknown) => void;
    }
  >();
  const listener = bridge.addListener("socket", (event) => {
    const socket = sockets.get(event.id);
    if (!socket) return;
    if (event.kind === "open") socket.open();
    else if (event.kind === "message")
      socket.message(fromBase64(event.data ?? ""));
    else if (event.kind === "error") socket.error(new Error("聊天连接失败"));
    else if (event.kind === "close") {
      sockets.delete(event.id);
      socket.close();
    }
  });
  return (url, options) => {
    if (new URL(url).protocol !== "wss:")
      throw new TypeError("Secure socket required");
    const id = crypto.randomUUID();
    let closed = false;
    const handlers = {
      open: () => {},
      message: (_data: unknown) => {},
      error: (_error: unknown) => {},
      close: (_event?: unknown) => {},
    };
    sockets.set(id, handlers);
    queueMicrotask(() => {
      void listener
        .then(() => {
          if (!closed)
            return bridge.openSocket({
              id,
              url,
              headers: options.headers,
              protocols: options.protocols,
            });
        })
        .catch((error) => {
          if (!closed) {
            sockets.delete(id);
            handlers.error(error);
          }
        });
    });
    return {
      send: (data) => bridge.sendSocket({ id, data: toBase64(data) }),
      close() {
        closed = true;
        sockets.delete(id);
        void bridge.closeSocket({ id }).catch(() => {});
      },
      onOpen: (fn) => {
        handlers.open = fn;
      },
      onMessage: (fn) => {
        handlers.message = fn;
      },
      onError: (fn) => {
        handlers.error = fn;
      },
      onClose: (fn) => {
        handlers.close = fn;
      },
    };
  };
}
