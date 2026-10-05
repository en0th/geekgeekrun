import { sendToDaemon } from "../flow/OPEN_SETTING_WINDOW/connect-to-daemon";
import minimist from "minimist";

// what happened during a run, newest last; the task page shows it as the execution log
export type TaskLogKind =
  | "viewed"
  | "collected"
  | "sent"
  | "skipped"
  | "marked"
  | "running"
  | "searching"
  | "waiting"
  | "resting"
  | "retrying"
  | "yielded"
  | "blocked"
  | "stopped"
  | "error";
export interface TaskLogEntry {
  at: number;
  kind: TaskLogKind | string;
  text: string;
}
// enough for a long run's recent history; each progress message carries the whole list
export const TASK_LOG_LIMIT = 300;

export function createTaskProgress() {
  const progress = {
    startedAt: Date.now(),
    viewed: 0,
    sent: 0,
    skipped: 0,
    // collect-only mode: job details saved without starting a chat
    collected: 0,
    marked: 0,
    state: "running",
    detail: "正在准备任务",
    listSummary: "",
    lastSkippedDetail: "",
    skippedReasons: {} as Record<string, number>,
    log: [] as TaskLogEntry[],
  };
  const runRecordId = minimist(process.argv.slice(2))["run-record-id"] ?? null;
  function addLog(kind: string, text: string) {
    if (!text) return;
    const last = progress.log[progress.log.length - 1];
    // a repeated status line (e.g. "检查下一批") is one entry, not one per batch
    if (last && last.kind === kind && last.text === text && !isCounted(kind)) {
      last.at = Date.now();
      return;
    }
    progress.log.push({ at: Date.now(), kind, text });
    if (progress.log.length > TASK_LOG_LIMIT)
      progress.log.splice(0, progress.log.length - TASK_LOG_LIMIT);
  }
  function send() {
    // Counts are emitted only from actual execution checkpoints, never from an estimated total.
    void Promise.resolve(sendToDaemon({
      type: "worker-to-gui-message",
      workerId: process.env.GEEKGEEKRUND_WORKER_ID,
      data: {
        type: "task-progress",
        runRecordId,
        progress: { ...progress, updatedAt: Date.now() },
      },
    })).catch(() => {});
  }
  function update(
    kind?: "viewed" | "sent" | "skipped" | "collected",
    detail = "",
    state = "running",
    diagnostics?: { listSummary?: string },
    // the log line for this step, e.g. "入库：公司 · 职位"; defaults to the detail
    logText?: string,
  ) {
    if (kind) progress[kind]++;
    if (kind === "skipped" && detail) {
      progress.lastSkippedDetail = detail;
      progress.skippedReasons[detail] = (progress.skippedReasons[detail] || 0) + 1;
    }
    if (diagnostics?.listSummary) progress.listSummary = diagnostics.listSummary;
    progress.state = state;
    if (detail) progress.detail = detail;
    addLog(kind || state, logText || detail);
    send();
  }
  /** a log line that changes no counter, e.g. a job marked as not suitable */
  function log(kind: string, text: string, counter?: "marked") {
    if (counter) progress[counter]++;
    addLog(kind, text);
    send();
  }
  return { update, log, progress };
}

const isCounted = (kind: string) =>
  ["viewed", "collected", "sent", "skipped", "marked"].includes(kind);
