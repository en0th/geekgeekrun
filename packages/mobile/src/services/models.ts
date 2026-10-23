import { ProtocolError, scopedId, idNumber } from "@recovered/zhijue-ai-sdk";
import type { AiSseEvent, JsonRecord } from "@recovered/zhijue-ai-sdk";

export const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
export const text = (value: unknown, fallback = "") =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
export function apiOrigin(input: string): string {
  const url = new URL(input.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new TypeError("请输入不含路径和账号的 HTTPS 服务地址");
  return url.origin;
}
export function positiveId(value: unknown): string {
  const id = scopedId("AiMessageId", value);
  idNumber("AiMessageId", id);
  return id.value;
}
export function messageText(input: unknown): string {
  const content = record(record(input).content);
  return Array.isArray(content.parts)
    ? content.parts
        .map((part) => text(record(part).text))
        .filter(Boolean)
        .join("\n")
    : "";
}
export interface JobCard {
  id: string;
  title: string;
  brand: string;
  salary: string;
  city: string;
  experience: string;
  degree: string;
  skills: string[];
  description: string;
  raw: JsonRecord;
}
export function pendingCard(raw: JsonRecord): JobCard {
  const content = record(raw.content),
    job = record(content.job_info || content.jobInfo);
  const id = scopedId("PendingResultId", raw.id).value;
  scopedId("PendingJobId", job.jobId || job.job_id);
  scopedId("PendingBossId", job.bossId || job.boss_id);
  return {
    id,
    title: text(job.positionName || job.title, "未命名岗位"),
    brand: text(job.brand, "公司信息待补充"),
    salary: text(job.salary, "薪资面议"),
    city: text(job.cityName),
    experience: text(job.experienceName),
    degree: text(job.degreeName),
    skills: Array.isArray(job.skills)
      ? job.skills.map((v) => text(v)).filter(Boolean)
      : [],
    description: text(job.description),
    raw,
  };
}
export interface Contact {
  id: string;
  name: string;
  title: string;
  brand: string;
  jobId: string;
  peerId: string;
  raw: JsonRecord;
}
export function deliveryContact(raw: JsonRecord): Contact {
  const snapshot = record(raw.jobSnapshot);
  return {
    id: scopedId("DeliveryRecordId", raw.id).value,
    name: text(snapshot.bossName, "招聘方"),
    title: text(snapshot.title, "职位沟通"),
    brand: text(snapshot.brand),
    jobId: scopedId("DeliveryZpJobId", snapshot.jobId ?? raw.zpJobId).value,
    peerId: scopedId("RecordBossUid", raw.zpBossUid || snapshot.bossId).value,
    raw,
  };
}
export interface ChatLine {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: string;
}
export interface AiState {
  conversationId?: string;
  parentId?: string;
  messages: JsonRecord[];
}
// Apply only the documented, bounded message patch shapes. Unknown shapes are
// replaced by a canonical messages/list refresh after DONE, never interpreted as jobs.
export function applyAiEvent(state: AiState, event: AiSseEvent): void {
  const data = record(event.data);
  if (event.event === "create_conversation") {
    const id = positiveId(data.id);
    if (state.conversationId && id !== state.conversationId)
      throw new ProtocolError("Conversation changed during stream");
    state.conversationId = id;
  }
  if (event.event !== "delta") return;
  const value = record(data.v);
  if (data.o === "add" && value.id !== undefined) {
    const id = positiveId(value.id);
    if (value.conversation_id !== undefined) {
      const cid = positiveId(value.conversation_id);
      if (state.conversationId && cid !== state.conversationId)
        throw new ProtocolError("Conversation changed during stream");
      state.conversationId = cid;
    }
    const index = state.messages.findIndex(
      (message) => String(message.id) === id,
    );
    const copy = structuredClone(value);
    if (index < 0) state.messages.push(copy);
    else state.messages[index] = copy;
    state.parentId = id;
    return;
  }
  const target = state.messages.find(
    (message) => String(message.id) === String(data.id),
  );
  if (
    !target ||
    typeof data.p !== "string" ||
    !["append", "replace", "patch"].includes(String(data.o))
  )
    return;
  const path = data.p.replace(/^\//, "").split(/[/.]/).filter(Boolean);
  if (
    !path.length ||
    path.length > 12 ||
    path.some((key) => ["__proto__", "prototype", "constructor"].includes(key))
  )
    return;
  let parent: JsonRecord | unknown[] = target;
  for (const key of path.slice(0, -1)) {
    const next = (parent as JsonRecord)[key];
    if (!next || typeof next !== "object") return;
    parent = next as JsonRecord;
  }
  const key = path.at(-1)!;
  const row = parent as JsonRecord;
  if (
    data.o === "append" &&
    typeof row[key] === "string" &&
    typeof data.v === "string"
  )
    row[key] += data.v;
  else if (data.o === "replace") row[key] = structuredClone(data.v);
  else if (
    data.o === "patch" &&
    row[key] &&
    typeof row[key] === "object" &&
    !Array.isArray(row[key])
  ) {
    const patch = record(data.v);
    for (const [field, v] of Object.entries(patch))
      if (!["__proto__", "prototype", "constructor"].includes(field))
        (row[key] as JsonRecord)[field] = structuredClone(v);
  }
}
export function aiLines(messages: JsonRecord[]): ChatLine[] {
  return messages
    .filter(
      (message) =>
        !record(message.metadata).is_visually_hidden_from_conversation,
    )
    .map(
      (message): ChatLine => ({
        id: text(message.id),
        role: record(message.author).role === "user" ? "user" : "assistant",
        text: messageText(message),
      }),
    )
    .filter((line) => line.text.trim());
}
export function errorMessage(error: unknown, write = false): string {
  const name = error instanceof Error ? error.name : "";
  const code = record(error).code;
  if (code === 7002) return "验证码无效或已过期，请重新获取";
  if (code === 400403) return "此账号需要邀请码，请联系服务方";
  if (code === 2002) return "账号暂不可用，请联系服务方";
  if (record(error).status === 429) return "操作过于频繁，请稍后重试";
  if (name === "AbortError") return "已停止本次请求";
  if (
    [
      "ReauthenticationRequiredError",
      "AuthenticationError",
      "LoginRejectedError",
    ].includes(name)
  )
    return "登录已失效或验证码无效，请重新登录";
  if (name === "LoginBootstrapError")
    return "已取得登录凭证，账号资料暂未加载成功，可稍后刷新";
  if (name === "SessionChangedError") return "账号已切换，本次操作已终止";
  if (name === "IncompleteStreamError")
    return "回复连接提前结束，请刷新对话核对结果";
  if (name === "ConfirmationRejectedError")
    return "服务未接受此次投递，请刷新岗位状态";
  if (write) return "未能确认操作结果，请先刷新记录核对，避免重复提交";
  return "连接或数据格式异常，请检查服务配置后重试";
}
