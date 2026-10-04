import { sendToDaemon } from "../flow/OPEN_SETTING_WINDOW/connect-to-daemon";
import minimist from "minimist";

export function createTaskProgress() {
  const progress = {
    startedAt: Date.now(),
    viewed: 0,
    sent: 0,
    skipped: 0,
    // collect-only mode: job details saved without starting a chat
    collected: 0,
    state: "running",
    detail: "正在准备任务",
    listSummary: "",
    lastSkippedDetail: "",
    skippedReasons: {} as Record<string, number>,
  };
  const runRecordId = minimist(process.argv.slice(2))["run-record-id"] ?? null;
  function update(
    kind?: "viewed" | "sent" | "skipped" | "collected",
    detail = "",
    state = "running",
    diagnostics?: { listSummary?: string },
  ) {
    if (kind) progress[kind]++;
    if (kind === "skipped" && detail) {
      progress.lastSkippedDetail = detail;
      progress.skippedReasons[detail] = (progress.skippedReasons[detail] || 0) + 1;
    }
    if (diagnostics?.listSummary) progress.listSummary = diagnostics.listSummary;
    progress.state = state;
    if (detail) progress.detail = detail;
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
  return { update, progress };
}
