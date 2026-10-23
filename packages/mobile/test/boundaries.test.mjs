import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuthenticatedClient,
  buildPendingRowConfirmation,
  scopedId,
  selectPendingRow,
  TaskDeliveryClient,
  SseSession,
} from "@recovered/zhijue-ai-sdk";
import {
  applyAiEvent,
  apiOrigin,
  deliveryContact,
  pendingCard,
  errorMessage,
} from "../src/services/models.ts";
import {
  createNativeBossFactory,
  createNativeFetch,
  fromBase64,
  toBase64,
} from "../src/services/native.ts";
const pending = () => ({
  id: 501,
  content: {
    job_info: { jobId: 601, bossId: 701, title: "测试岗位", skills: ["Vue"] },
  },
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function bridge(overrides = {}) {
  const listeners = {},
    calls = [];
  return {
    calls,
    listeners,
    addListener: async (name, listener) => {
      listeners[name] = listener;
      return { remove: async () => {} };
    },
    request: async (options) => {
      calls.push(options);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        data: toBase64(new TextEncoder().encode('{"code":0,"result":[]}')),
      };
    },
    stream: async (options) => {
      calls.push(options);
    },
    cancel: async (options) => {
      calls.push({ cancel: options.id });
    },
    openSocket: async (options) => {
      calls.push(options);
    },
    sendSocket: async (options) => {
      calls.push({ send: options });
    },
    closeSocket: async (options) => {
      calls.push({ close: options.id });
    },
    ...overrides,
  };
}
test("pending confirmation uses independently selected P.id without inventing task or result IDs", async () => {
  const requests = [];
  const rt = createAuthenticatedClient({
    baseUrl: "https://service.example",
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return Response.json({ code: 0, result: { status: "ADD_FRIEND" } });
    },
  });
  rt.sessions.setSession({
    accessToken: "fixture",
    userId: 1,
    expiresAt: Date.now() + 60000,
  });
  const row = pending(),
    selection = selectPendingRow(
      [row],
      scopedId("PendingResultId", 501),
      rt.client.sessionOptions(),
    );
  row.content.job_info.title = "changed";
  const outcome = await new TaskDeliveryClient(rt.client).confirmPending(
    selection,
  );
  assert.equal(outcome.status, "ADD_FRIEND");
  assert.equal(outcome.resumeAttachmentReceipt, "unknown");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.messageId, 501);
  assert.equal(requests[0].body.jobDetail.jobId, 601);
  assert.equal(requests[0].body.jobDetail.title, "测试岗位");
  assert.equal("taskId" in requests[0].body, false);
  rt.client.dispose();
});
test("pending identity tampering and cross-account submission fail before a write", async () => {
  let writes = 0;
  const rt = createAuthenticatedClient({
    baseUrl: "https://service.example",
    fetch: async () => {
      writes++;
      return Response.json({});
    },
  });
  rt.sessions.setSession({ accessToken: "a", expiresAt: Date.now() + 60000 });
  const selected = selectPendingRow(
    [pending()],
    scopedId("PendingResultId", 501),
    rt.client.sessionOptions(),
  );
  selected.raw.id = 999;
  assert.throws(
    () => buildPendingRowConfirmation(selected),
    /identity changed/,
  );
  const original = selectPendingRow(
    [pending()],
    scopedId("PendingResultId", 501),
    rt.client.sessionOptions(),
  );
  rt.sessions.setSession({ accessToken: "b", expiresAt: Date.now() + 60000 });
  await assert.rejects(
    new TaskDeliveryClient(rt.client).confirmPending(original),
    { name: "SessionChangedError" },
  );
  assert.equal(writes, 0);
  rt.client.dispose();
});
test("confirmation uncertainty is not retried or shown as successful delivery", async () => {
  let writes = 0;
  const rt = createAuthenticatedClient({
    baseUrl: "https://service.example",
    fetch: async () => {
      writes++;
      return Response.json({ code: 0, result: { status: "PENDING" } });
    },
  });
  rt.sessions.setSession({ accessToken: "a", expiresAt: Date.now() + 60000 });
  const selected = selectPendingRow(
    [pending()],
    scopedId("PendingResultId", 501),
    rt.client.sessionOptions(),
  );
  await assert.rejects(
    new TaskDeliveryClient(rt.client).confirmPending(selected),
    { name: "ConfirmationRejectedError" },
  );
  assert.equal(writes, 1);
  assert.match(errorMessage(new Error(), true), /核对/);
  rt.client.dispose();
});
test("card and contact namespaces come from their own payloads, not AI task fields", () => {
  assert.equal(pendingCard(pending()).id, "501");
  assert.throws(() => pendingCard({ id: 1, task_result_id: 501 }));
  const contact = deliveryContact({
    id: 801,
    zpJobId: 901,
    zpBossUid: 1001,
    jobSnapshot: { jobId: 902, bossId: 1002, bossName: "模拟招聘方" },
  });
  assert.equal(contact.id, "801");
  assert.equal(contact.jobId, "902");
  assert.equal(contact.peerId, "1001");
  for (const url of [
    "http://service.example",
    "https://name:secret@service.example",
    "https://service.example/path",
    "https://service.example/?token=a",
  ])
    assert.throws(() => apiOrigin(url));
  assert.equal(
    apiOrigin("https://service.example/"),
    "https://service.example",
  );
});
test("AI reducer keeps conversation ownership and refuses prototype patch paths", () => {
  const state = { messages: [] };
  const ev = (data) => ({
    event: "delta",
    data,
    done: false,
    raw: { data: "" },
  });
  applyAiEvent(
    state,
    ev({
      o: "add",
      v: {
        id: 11,
        conversation_id: 10,
        content: { parts: [{ text: "你好" }] },
      },
    }),
  );
  applyAiEvent(
    state,
    ev({ o: "append", id: 11, p: "/content/parts/0/text", v: "世界" }),
  );
  assert.equal(state.messages[0].content.parts[0].text, "你好世界");
  applyAiEvent(
    state,
    ev({ o: "replace", id: 11, p: "/__proto__/polluted", v: true }),
  );
  assert.equal({}.polluted, undefined);
  assert.throws(
    () =>
      applyAiEvent(state, ev({ o: "add", v: { id: 12, conversation_id: 99 } })),
    /Conversation changed/,
  );
});
test("native SSE preserves fragmented multibyte data through SDK DONE and cancels reader once", async () => {
  const b = bridge();
  const transport = createNativeFetch(b);
  const stream = new SseSession((signal) =>
    transport("https://service.example/stream", {
      signal,
      headers: { Accept: "text/event-stream" },
    }),
  );
  const result = (async () => {
    const rows = [];
    for await (const event of stream) rows.push(event);
    return rows;
  })();
  await tick();
  const id = b.calls[0].id;
  b.listeners.network({
    id,
    kind: "headers",
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  const bytes = new TextEncoder().encode(
    'event: delta\ndata: {"o":"append","v":"中文😀"}\n\ndata: [DONE]\n\n',
  );
  for (let i = 0; i < bytes.length; i += 3)
    b.listeners.network({
      id,
      kind: "chunk",
      data: toBase64(bytes.slice(i, i + 3)),
    });
  const rows = await result;
  assert.equal(rows[0].data.v, "中文😀");
  assert.equal((await stream.completion).termination, "done");
  assert.equal(b.calls.filter((value) => value.cancel === id).length, 1);
  b.listeners.network({ id, kind: "end" });
});
test("native transport aborts pending HTTP immediately and ignores its late response", async () => {
  let complete;
  const b = bridge({
    request: (options) => {
      b.calls.push(options);
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  });
  const transport = createNativeFetch(b),
    controller = new AbortController();
  const promise = transport("https://service.example", {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
  complete({ status: 200, headers: {}, data: "" });
  assert.equal(b.calls.filter((value) => value.cancel).length, 1);
});
test("native stream rejects missing headers and handles cancellation before headers", async () => {
  const b = bridge(),
    transport = createNativeFetch(b);
  const missing = transport("https://service.example", {
    headers: { accept: "text/event-stream" },
  });
  await tick();
  b.listeners.network({ id: b.calls[0].id, kind: "end" });
  await assert.rejects(missing, /before headers/);
  const controller = new AbortController(),
    promise = transport("https://service.example", {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
  await tick();
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
  assert.equal(b.calls.filter((value) => value.cancel).length, 2);
});
test("native JSON, empty HTTP and multipart bodies retain status, headers and bytes", async () => {
  const b = bridge(),
    transport = createNativeFetch(b);
  assert.deepEqual(
    await (
      await transport("https://service.example", {
        method: "POST",
        headers: { Authorization: "Bearer fixture" },
        body: "{}",
      })
    ).json(),
    { code: 0, result: [] },
  );
  assert.equal(b.calls[0].headers.authorization, "Bearer fixture");
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array([0, 255, 10])], { type: "application/pdf" }),
    "resume.pdf",
  );
  await transport("https://service.example/upload", {
    method: "POST",
    body: form,
  });
  assert.deepEqual([...fromBase64(b.calls[1].parts[0].data)], [0, 255, 10]);
  const empty = createNativeFetch(
    bridge({ request: async () => ({ status: 204, headers: {}, data: "" }) }),
  );
  assert.equal((await empty("https://service.example")).body, null);
  await assert.rejects(transport("http://service.example"));
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    transport("https://service.example", { signal: cancelled.signal }),
    { name: "AbortError" },
  );
});
test("native MQTT adapter forwards required upgrade headers and binary frames, close prevents a late open", async () => {
  const b = bridge(),
    factory = createNativeBossFactory(b);
  const options = {
    protocols: ["mqtt"],
    headers: {
      wt: "fixture-token",
      wt2: "fixture-ticket",
      zp_product_id: "fixture-product",
    },
  };
  const socket = factory("wss://socket.example/chat", options);
  let received,
    opened = false;
  socket.onMessage((value) => {
    received = value;
  });
  socket.onOpen(() => {
    opened = true;
  });
  await tick();
  const id = b.calls[0].id;
  assert.deepEqual(b.calls[0].headers, options.headers);
  assert.deepEqual(b.calls[0].protocols, ["mqtt"]);
  b.listeners.socket({ id, kind: "open" });
  b.listeners.socket({
    id,
    kind: "message",
    data: toBase64(new Uint8Array([32, 2, 0, 0])),
  });
  assert.equal(opened, true);
  assert.deepEqual([...received], [32, 2, 0, 0]);
  await socket.send(new Uint8Array([192, 0]));
  assert.equal(b.calls[1].send.data, "wAA=");
  socket.close();
  b.listeners.socket({ id, kind: "message", data: "AA==" });
  assert.deepEqual([...received], [32, 2, 0, 0]);
  const closed = factory("wss://socket.example/chat", options);
  closed.close();
  await tick();
  assert.equal(b.calls.filter((value) => value.url).length, 1);
});
