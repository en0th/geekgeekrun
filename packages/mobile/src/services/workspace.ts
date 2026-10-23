import { reactive } from "vue";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App as NativeApp } from "@capacitor/app";
import {
  BossHttpClient,
  BossImClient,
  TaskDeliveryClient,
  buildDouziText,
  createAuthenticatedClient,
  enrichDeliveryRecords,
  requireRows,
  scopedId,
  selectPendingRow,
} from "@recovered/zhijue-ai-sdk";
import type {
  AuthSession,
  BossCredentials,
  CaptchaProof,
  JsonRecord,
  SseSession,
} from "@recovered/zhijue-ai-sdk";
import {
  MobileBridge,
  createNativeBossFactory,
  createNativeFetch,
  isNative,
} from "./native.ts";
import {
  aiLines,
  apiOrigin,
  applyAiEvent,
  deliveryContact,
  errorMessage,
  pendingCard,
  record,
  text,
} from "./models.ts";
import type { AiState, ChatLine, Contact, JobCard } from "./models.ts";
import { demoContacts, demoJobs, welcome } from "./demo.ts";

type Runtime = ReturnType<typeof createAuthenticatedClient>;
const stored = () => {
  try {
    return record(
      JSON.parse(localStorage.getItem("geekgeekrun.config") || "{}"),
    );
  } catch {
    return {};
  }
};
export function createWorkspace() {
  const settings = stored();
  const state = reactive({
    tab: "assistant",
    demo: true,
    origin: text(settings.origin),
    verificationUrl: text(settings.verificationUrl),
    loggedIn: false,
    userName: "求职者",
    busy: "",
    error: "",
    notice: "",
    connection: "未连接",
    ai: [{ id: "welcome", role: "assistant", text: welcome }] as ChatLine[],
    jobs: demoJobs(),
    contacts: demoContacts(),
    chat: [] as ChatLine[],
    tasks: [] as JsonRecord[],
    results: [] as JsonRecord[],
    currentContact: null as Contact | null,
    workModeSignal: "",
    expiresAt: 0,
    privacy: false,
  });
  let runtime: Runtime | undefined;
  let scopeVersion = 0;
  let stream: SseSession | undefined;
  let im: BossImClient | undefined;
  let credentials: BossCredentials | undefined;
  let peerId = "";
  let chatVersion = 0;
  let aiState: AiState = { messages: [] };
  let unsubscribe: (() => void) | undefined;
  let proofNonce = "";
  let proofPhone = "";
  let verificationProof: CaptchaProof | undefined;
  let vaultQueue: Promise<unknown> = Promise.resolve();
  const nativeFetch = isNative() ? createNativeFetch(MobileBridge) : undefined;
  const nativeBossFactory = isNative()
    ? createNativeBossFactory(MobileBridge)
    : undefined;
  function resetViews() {
    chatVersion++;
    stream?.abort();
    stream = undefined;
    im?.disconnect();
    im = undefined;
    credentials = undefined;
    peerId = "";
    aiState = { messages: [] };
    state.ai = [];
    state.jobs = [];
    state.contacts = [];
    state.tasks = [];
    state.results = [];
    state.chat = [];
    state.currentContact = null;
    state.workModeSignal = "";
    state.connection = "未连接";
  }
  function persist() {
    if (!runtime || !isNative()) return;
    const session = runtime.sessions.exportSession();
    const value = session
      ? JSON.stringify({ origin: state.origin, session })
      : null;
    vaultQueue = vaultQueue
      .catch(() => {})
      .then(() =>
        value
          ? MobileBridge.writeSession({ value })
          : MobileBridge.clearSession(),
      )
      .catch(() => {
        state.notice = "凭证未能保存，退出应用后需要重新登录";
      });
  }
  function detach() {
    scopeVersion++;
    unsubscribe?.();
    unsubscribe = undefined;
    resetViews();
    runtime?.client.dispose();
    runtime = undefined;
    state.loggedIn = false;
    state.expiresAt = 0;
  }
  function configure(origin: string) {
    detach();
    state.origin = apiOrigin(origin);
    runtime = createAuthenticatedClient({
      baseUrl: state.origin,
      fetch: nativeFetch,
    });
    const current = runtime;
    unsubscribe = current.sessions.onSessionChange(() => {
      if (current !== runtime) return;
      scopeVersion++;
      resetViews();
      state.loggedIn = current.sessions.authenticated;
      state.expiresAt = current.sessions.snapshot().expiresAt ?? 0;
      persist();
    });
    localStorage.setItem(
      "geekgeekrun.config",
      JSON.stringify({
        origin: state.origin,
        verificationUrl: state.verificationUrl,
      }),
    );
  }
  function live() {
    if (state.demo || !runtime) throw new Error("请先连接服务");
    if (!runtime.sessions.authenticated)
      throw Object.assign(new Error("需要登录"), {
        name: "ReauthenticationRequiredError",
      });
    return runtime;
  }
  async function run(
    label: string,
    operation: () => Promise<void>,
    write = false,
  ) {
    if (state.busy) return;
    state.busy = label;
    state.error = "";
    state.notice = "";
    const owner = scopeVersion;
    try {
      await operation();
    } catch (error) {
      if (owner === scopeVersion || label === "login") {
        state.error = errorMessage(error, write);
        if (label === "chat") state.connection = "连接已断开";
        if (runtime) {
          state.loggedIn = runtime.sessions.authenticated;
          state.expiresAt = runtime.sessions.snapshot().expiresAt ?? 0;
          persist();
        }
      }
    } finally {
      if (state.busy === label) state.busy = "";
    }
  }
  function connect(origin: string, verificationUrl: string) {
    try {
      if (verificationUrl) {
        const u = new URL(verificationUrl);
        if (u.protocol !== "https:" || u.username || u.password || u.hash)
          throw new TypeError("HTTPS verification URL required");
      }
      state.verificationUrl = verificationUrl.trim();
      configure(origin);
      state.demo = false;
      state.notice = "服务已配置，请使用验证码登录";
      return true;
    } catch {
      state.error = "请输入有效的 HTTPS 服务地址和验证页面地址";
      return false;
    }
  }
  function experience() {
    detach();
    state.demo = true;
    state.ai = [{ id: "welcome", role: "assistant", text: welcome }];
    state.jobs = demoJobs();
    state.contacts = demoContacts();
    state.error = "";
    state.notice = "体验数据已重置";
  }
  async function restore() {
    if (!isNative() || !state.origin) return;
    try {
      const saved = await MobileBridge.readSession();
      if (!saved.value) return;
      const parsed = JSON.parse(saved.value) as {
        origin: string;
        session: AuthSession;
      };
      if (apiOrigin(parsed.origin) !== apiOrigin(state.origin)) return;
      configure(state.origin);
      if (parsed.session.expiresAt <= Date.now()) {
        await MobileBridge.clearSession();
        return;
      }
      runtime!.sessions.setSession(parsed.session);
      state.demo = false;
      state.notice = "已恢复本机登录，可手动刷新数据";
    } catch {
      await MobileBridge.clearSession().catch(() => {});
    }
  }
  async function openVerification(phone: string) {
    if (!/^1\d{10}$/.test(phone)) {
      state.error = "请输入正确的手机号";
      return;
    }
    if (!state.verificationUrl) {
      state.error = "请先配置服务方提供的验证页面";
      return;
    }
    if (!isNative()) {
      state.error = "网页预览仅支持输入已获取的验证码；验证回调需要安装应用";
      return;
    }
    proofNonce = crypto.randomUUID();
    proofPhone = phone;
    verificationProof = undefined;
    const url = new URL(state.verificationUrl);
    url.searchParams.set("phone", phone);
    url.searchParams.set("state", proofNonce);
    url.searchParams.set("redirect_uri", "geekgeekrun://auth/proof");
    await Browser.open({ url: url.toString() });
  }
  async function onUrl(url: string) {
    try {
      const u = new URL(url);
      if (
        u.protocol !== "geekgeekrun:" ||
        u.host !== "auth" ||
        u.pathname !== "/proof" ||
        !proofNonce ||
        u.searchParams.get("state") !== proofNonce
      )
        return;
      proofNonce = "";
      const raw = u.searchParams.get("proof");
      if (!raw || raw.length > 16000) throw new Error();
      const p = JSON.parse(raw);
      if (![1, 3, 4].includes(p.type)) throw new Error();
      verificationProof = p;
      await Browser.close();
      await run(
        "code",
        async () => {
          if (!runtime) throw new Error();
          await runtime.auth.sendPhoneCode(proofPhone, verificationProof!);
          verificationProof = undefined;
          state.notice = "验证码已发送，请查收短信";
        },
        true,
      );
    } catch {
      verificationProof = undefined;
      state.error = "验证回调不完整，请重新完成验证";
    }
  }
  async function login(phone: string, code: string) {
    await run("login", async () => {
      if (!runtime || state.demo) throw new Error();
      if (!/^1\d{10}$/.test(phone) || !/^\d{4,8}$/.test(code))
        throw Object.assign(new Error(), { name: "LoginRejectedError" });
      const out = await runtime.auth.loginWithPhoneCode(phone, code, {
        platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
      });
      state.userName = text(out.profile?.data?.name, "求职者");
      state.notice =
        out.authorizationRequired === true
          ? "登录成功；请在账号页完成 BOSS 数据授权"
          : "登录成功，可开始对话";
    });
  }
  async function authorize() {
    await run(
      "authorize",
      async () => {
        const rt = live();
        await rt.auth.authorizeBossData();
        state.notice = "BOSS 数据授权流程已完成";
      },
      true,
    );
  }
  async function logout() {
    await run("logout", async () => {
      const current = runtime;
      try {
        if (current?.sessions.hasSession) await current.auth.logout();
      } finally {
        current?.sessions.clear();
        await vaultQueue;
        await MobileBridge.clearSession().catch(() => {});
        state.loggedIn = false;
        state.notice = "已退出登录并清除本机凭证";
      }
    });
  }
  async function canonical(rt: Runtime, version: number) {
    if (!aiState.conversationId) return;
    const response = await rt.client.messages({
      conversation_id: aiState.conversationId,
    });
    if (version !== scopeVersion) return;
    const rows = requireRows(response, "messages/list");
    aiState.messages = rows;
    state.ai = aiLines(rows);
    // History ordering is not verified. Keep the parent observed in this SSE
    // round; never replace it with an assumed newest/oldest array element.
  }
  async function sendAI(input: string) {
    if (!input.trim()) return;
    await run(
      "ai",
      async () => {
        if (state.demo) {
          state.ai.push({
            id: crypto.randomUUID(),
            role: "user",
            text: input.trim(),
          });
          await new Promise((resolve) => setTimeout(resolve, 350));
          state.ai.push({
            id: crypto.randomUUID(),
            role: "assistant",
            text: "我整理了 3 个示例岗位，覆盖前端、AI 应用和移动端方向。你可以在「岗位」中查看详情，体验确认投递。\n\n这些是虚构数据。连接你有权使用的服务后，可获取真实结果。",
          });
          return;
        }
        const rt = live(),
          version = scopeVersion;
        state.ai.push({
          id: "local-" + crypto.randomUUID(),
          role: "user",
          text: input.trim(),
        });
        const next = rt.client.userSay(
          buildDouziText(input, {
            context: {
              parent: aiState.parentId,
              conversation_id: aiState.conversationId,
            },
          }),
        );
        stream = next;
        try {
          for await (const event of next) {
            if (version !== scopeVersion) return;
            applyAiEvent(aiState, event);
            const lines = aiLines(aiState.messages);
            if (lines.length) state.ai = lines;
            if (event.workModeSignal)
              state.workModeSignal = event.workModeSignal;
          }
          const completion = await next.completion;
          if (completion.termination === "done") {
            await canonical(rt, version);
            if (version === scopeVersion)
              state.notice = "回复已完成，可查询任务进度或刷新待确认岗位";
          }
        } finally {
          if (stream === next) stream = undefined;
        }
      },
      true,
    );
  }
  async function stopAI() {
    stream?.abort();
    stream = undefined;
    state.notice = "已停止接收回复；后台任务状态请通过任务查询核对";
  }
  async function refreshAI() {
    await run("history", async () => {
      const rt = live();
      await canonical(rt, scopeVersion);
    });
  }
  function newConversation() {
    if (state.busy) return;
    aiState = { messages: [] };
    state.ai = [{ id: "welcome", role: "assistant", text: welcome }];
    state.tasks = [];
    state.results = [];
    state.workModeSignal = "";
    state.error = "";
    state.notice = "已开始新对话；先前的后台任务可能仍在运行";
  }
  async function refreshTasks() {
    await run("tasks", async () => {
      if (state.demo) {
        state.tasks = [{ id: 9401, status: "COMPLETED", messageId: 9402 }];
        state.results = [
          {
            id: 9403,
            status: "COMPLETED",
            content: { summary: "已找到 3 个示例岗位" },
          },
        ];
        return;
      }
      const rt = live(),
        v = scopeVersion;
      if (!aiState.conversationId) {
        state.notice = "先发送一条消息，建立对话后再查询任务";
        return;
      }
      const rows = requireRows(
        await new TaskDeliveryClient(rt.client).tasks(
          scopedId("AiConversationId", aiState.conversationId),
          rt.client.sessionOptions(),
        ),
        "task/list",
      );
      if (v !== scopeVersion) return;
      state.tasks = rows;
      state.results = [];
    });
  }
  async function taskResults(task: JsonRecord) {
    await run("results", async () => {
      if (state.demo) return;
      const rt = live(),
        v = scopeVersion;
      const rows = requireRows(
        await new TaskDeliveryClient(rt.client).results(
          scopedId("AiTaskId", task.id),
          rt.client.sessionOptions(),
        ),
        "result/list",
      );
      if (v === scopeVersion) state.results = rows;
    });
  }
  async function refreshJobs() {
    await run("jobs", async () => {
      if (state.demo) {
        state.jobs = demoJobs();
        return;
      }
      const rt = live(),
        v = scopeVersion;
      const rows = requireRows(
        await new TaskDeliveryClient(rt.client).pending(
          rt.client.sessionOptions(),
        ),
        "pending",
      );
      const cards = rows.map(pendingCard);
      if (v === scopeVersion) state.jobs = cards;
    });
  }
  async function confirmJob(job: JobCard) {
    await run(
      "delivery",
      async () => {
        if (state.demo) {
          state.jobs = state.jobs.filter((row) => row.id !== job.id);
          state.notice = "体验投递已确认，没有向外部服务发送请求";
          return;
        }
        const rt = live(),
          v = scopeVersion;
        const selection = selectPendingRow(
          state.jobs.map((row) => row.raw),
          scopedId("PendingResultId", job.id),
          rt.client.sessionOptions(),
        );
        await new TaskDeliveryClient(rt.client).confirmPending(selection);
        if (v !== scopeVersion) return;
        state.jobs = state.jobs.filter((row) => row.id !== job.id);
        state.notice = "已提交确认，实际状态请刷新投递记录核对";
      },
      true,
    );
  }
  async function refreshContacts() {
    await run("contacts", async () => {
      if (state.demo) {
        state.contacts = demoContacts();
        return;
      }
      const rt = live(),
        v = scopeVersion,
        http = new BossHttpClient(rt.client),
        scope = rt.client.sessionOptions();
      let rows = await http.deliveryRecords({}, scope);
      const ids = rows
        .map((row) => row.zpJobId || record(row.jobSnapshot).jobId)
        .filter(Boolean) as string[];
      if (ids.length)
        rows = enrichDeliveryRecords(
          rows,
          await http.lookupDeliveryJobs(ids, scope),
        );
      const contacts = rows.map(deliveryContact);
      if (v === scopeVersion) state.contacts = contacts;
    });
  }
  async function openContact(contact: Contact) {
    await run("chat", async () => {
      const connectionVersion = ++chatVersion;
      im?.disconnect();
      im = undefined;
      state.currentContact = contact;
      state.chat = [];
      state.connection = "正在连接";
      if (state.demo) {
        state.connection = "体验会话";
        state.chat = [
          {
            id: "demo-hi",
            role: "assistant",
            text: "你好，很高兴认识你。这是体验会话，消息仅保留在本次体验中。",
          },
        ];
        return;
      }
      const rt = live(),
        v = scopeVersion,
        epoch = rt.sessions.epoch,
        scope = { sessionEpoch: epoch },
        http = new BossHttpClient(rt.client);
      if (!nativeBossFactory) throw new Error("Native transport required");
      const resolved = await http.resolvePeer(
        { jobId: contact.jobId, friendId: contact.peerId },
        scope,
      );
      const creds = await http.getCredentials(scope);
      const history = await http.history(
        { userId: creds.zpUserId, friendId: resolved.friendId },
        scope,
      );
      if (v !== scopeVersion || connectionVersion !== chatVersion) return;
      if (history.code !== 0 && history.code !== 1000)
        throw new Error("History unavailable");
      const historyRows = history.result?.messageList ?? [];
      state.chat = historyRows.map((value, index) => {
        const m = record(value),
          body = record(m.body),
          from = record(m.from);
        return {
          id: text(m.mid, String(index)),
          role:
            text(from.uid || m.fromUid) === creds.zpUserId
              ? ("user" as const)
              : ("assistant" as const),
          text: text(body.text || m.text, "[暂不支持的消息类型]"),
        };
      });
      credentials = creds;
      peerId = resolved.friendId;
      const socket = new BossImClient({
        credentials: creds,
        webSocketFactory: nativeBossFactory,
      });
      im = socket;
      socket.on("state", (status) => {
        if (
          v === scopeVersion &&
          connectionVersion === chatVersion &&
          im === socket
        )
          state.connection =
            status === "connected"
              ? "已连接"
              : status === "connecting"
                ? "正在连接"
                : "连接已断开";
      });
      socket.on("message", (message) => {
        if (
          v !== scopeVersion ||
          connectionVersion !== chatVersion ||
          im !== socket
        )
          return;
        const m = record(message),
          from = record(m.from),
          to = record(m.to);
        if (![text(from.uid), text(to.uid)].includes(resolved.friendId)) return;
        const identifiers = [text(m.mid), text(m.cmid)].filter(Boolean);
        if (state.chat.some((line) => identifiers.includes(line.id))) return;
        state.chat.push({
          id: text(m.mid, crypto.randomUUID()),
          role: text(from.uid) === creds.zpUserId ? "user" : "assistant",
          text: text(record(m.body).text, "[暂不支持的消息类型]"),
        });
      });
      socket.on("error", () => {
        if (
          v === scopeVersion &&
          connectionVersion === chatVersion &&
          im === socket
        )
          state.error = "聊天连接中断，请手动重新连接；未自动重发消息";
      });
      await socket.connect();
    });
  }
  async function sendBoss(input: string) {
    if (!input.trim()) return;
    await run(
      "send",
      async () => {
        if (state.demo) {
          state.chat.push({
            id: crypto.randomUUID(),
            role: "user",
            text: input.trim(),
            status: "体验消息",
          });
          return;
        }
        live();
        if (!im || !credentials || !peerId) throw new Error();
        const v = scopeVersion,
          connectionVersion = chatVersion,
          handle = im.sendText({ to: peerId, text: input.trim() });
        const line: ChatLine = {
          id: handle.cmid,
          role: "user",
          text: input.trim(),
          status: "已排队",
        };
        state.chat.push(line);
        const update = (status: string) => {
          if (v !== scopeVersion || connectionVersion !== chatVersion) return;
          const row = state.chat.find((item) => item.id === handle.cmid);
          if (row) row.status = status;
        };
        void handle.brokerReceived
          .then(() => update("服务器已接收"))
          .catch(() => {});
        void handle.read.then(() => update("已读")).catch(() => {});
        try {
          await handle.brokerAck;
          update("已确认接收");
        } catch (error) {
          update("结果未确认，请核对会话");
          throw error;
        }
      },
      true,
    );
  }
  function closeContact() {
    chatVersion++;
    im?.disconnect();
    im = undefined;
    credentials = undefined;
    peerId = "";
    state.currentContact = null;
    state.chat = [];
    state.connection = "未连接";
  }
  if (isNative()) {
    void NativeApp.addListener("appUrlOpen", (event) => {
      void onUrl(event.url);
    });
    void NativeApp.addListener("appStateChange", (event) => {
      if (!event.isActive) {
        stream?.abort();
        chatVersion++;
        im?.disconnect();
        im = undefined;
        credentials = undefined;
        peerId = "";
        state.connection = "连接已断开";
      } else if (runtime && !runtime.sessions.authenticated) {
        state.loggedIn = false;
        state.expiresAt = 0;
        state.notice = "登录已过期，请重新登录";
      }
    });
  }
  void restore();
  return {
    state,
    connect,
    experience,
    openVerification,
    login,
    authorize,
    logout,
    sendAI,
    stopAI,
    refreshAI,
    newConversation,
    refreshTasks,
    taskResults,
    refreshJobs,
    confirmJob,
    refreshContacts,
    openContact,
    closeContact,
    sendBoss,
  };
}
