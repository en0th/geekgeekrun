import { ZhijueAIClient } from "./client.js";
import {
  ConfirmationRejectedError,
  ProtocolError,
  RuntimeAssociationRequiredError,
  SessionChangedError,
} from "./errors.js";
import { idNumber, idValue, scopedId } from "./ids.js";
import type { ScopedId } from "./ids.js";
import type { ApiResult, JsonRecord, RequestOptions } from "./types.js";

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
export function requireRows(
  result: ApiResult<unknown>,
  label: string,
): JsonRecord[] {
  if (!Array.isArray(result.data))
    throw new ProtocolError(
      `${label} did not return the observed array shape; inspect raw`,
    );
  return result.data.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ProtocolError(`Invalid row in ${label}`);
    return value as JsonRecord;
  });
}
export interface RuntimeAssociation {
  source: "runtime-evidence" | "synthetic-fixture";
  /** Caller-owned observation/provenance, never an invented server response field. */
  evidence: string;
}
function association(
  proof: RuntimeAssociation | undefined,
  edge: string,
): RuntimeAssociation {
  if (
    !proof ||
    !["runtime-evidence", "synthetic-fixture"].includes(proof.source) ||
    !proof.evidence.trim()
  )
    throw new RuntimeAssociationRequiredError(edge);
  return { ...proof };
}
function selectedRow(
  rows: readonly JsonRecord[],
  id: string,
  label: string,
): JsonRecord {
  const row = rows.find((value) => String(value.id) === id);
  if (!row)
    throw new ProtocolError(
      `${label} ID is not in the independently fetched rows`,
    );
  return row;
}
export interface PendingRowSelection {
  readonly pendingId: ScopedId<"PendingResultId">;
  readonly jobId: ScopedId<"PendingJobId">;
  readonly bossId: ScopedId<"PendingBossId">;
  readonly raw: JsonRecord;
  readonly sessionEpoch?: number;
}
export interface PendingDeliverySelection extends PendingRowSelection {
  readonly taskId: ScopedId<"AiTaskId">;
  readonly resultId: ScopedId<"AiTaskResultId">;
  readonly association: RuntimeAssociation;
}
/** A user-selected row from the independent pending list needs no invented AI linkage. */
export function selectPendingRow(
  rows: readonly JsonRecord[],
  id: ScopedId<"PendingResultId">,
  scope: RequestOptions = {},
): PendingRowSelection {
  const raw = selectedRow(
    rows,
    idValue("PendingResultId", id),
    "Pending confirmation",
  );
  // Snapshot the wire data: subsequent refreshes/mutations cannot change the selected action.
  const copy = JSON.parse(JSON.stringify(raw)) as JsonRecord;
  const content = record(copy.content),
    job = record(content.job_info || content.jobInfo);
  return Object.freeze({
    pendingId: id,
    jobId: scopedId("PendingJobId", job.jobId || job.job_id),
    bossId: scopedId("PendingBossId", job.bossId || job.boss_id),
    raw: copy,
    sessionEpoch: scope.sessionEpoch,
  });
}
/** No R.id -> P.id conversion exists here. P must be selected from a separate query. */
export function bindPendingDelivery(
  pendingRows: readonly JsonRecord[],
  pendingId: ScopedId<"PendingResultId">,
  source: {
    taskId: ScopedId<"AiTaskId">;
    resultId: ScopedId<"AiTaskResultId">;
  },
  proof: RuntimeAssociation,
  scope: RequestOptions = {},
): PendingDeliverySelection {
  const provenance = association(
    proof,
    "AI result -> pending confirmation row",
  );
  const pid = idValue("PendingResultId", pendingId);
  idValue("AiTaskId", source.taskId);
  idValue("AiTaskResultId", source.resultId);
  const raw = selectedRow(pendingRows, pid, "Pending confirmation");
  const content = record(raw.content),
    job = record(content.job_info || content.jobInfo);
  return Object.freeze({
    pendingId,
    taskId: source.taskId,
    resultId: source.resultId,
    jobId: scopedId("PendingJobId", job.jobId || job.job_id),
    bossId: scopedId("PendingBossId", job.bossId || job.boss_id),
    raw,
    association: provenance,
    sessionEpoch: scope.sessionEpoch,
  });
}
export function buildConfirmedResume(selection: PendingDeliverySelection): {
  messageId: number;
  jobDetail: JsonRecord;
} {
  association(selection.association, "AI result -> pending confirmation row");
  return buildPendingRowConfirmation(selection);
}
/** messageId is P.id, never an AI message/task/result ID. */
export function buildPendingRowConfirmation(selection: PendingRowSelection): {
  messageId: number;
  jobDetail: JsonRecord;
} {
  const content = record(selection.raw.content),
    input = record(content.job_info || content.jobInfo);
  const jobId = scopedId("PendingJobId", input.jobId || input.job_id),
    bossId = scopedId("PendingBossId", input.bossId || input.boss_id);
  if (
    jobId.value !== idValue("PendingJobId", selection.jobId) ||
    bossId.value !== idValue("PendingBossId", selection.bossId) ||
    String(selection.raw.id) !== idValue("PendingResultId", selection.pendingId)
  )
    throw new ProtocolError("Pending row identity changed after selection");
  const detail: JsonRecord = {};
  for (const key of [
    "title",
    "brand",
    "salary",
    "cityName",
    "experienceName",
    "degreeName",
    "description",
    "companyStage",
    "companyScale",
    "industryName",
    "jobUrl",
  ])
    detail[key] = String(input[key] || "").trim();
  detail.positionName = String(input.positionName || input.title || "").trim();
  detail.jobId = idNumber("PendingJobId", jobId);
  detail.bossId = idNumber("PendingBossId", bossId);
  detail.skills = Array.isArray(input.skills)
    ? input.skills.filter(Boolean)
    : [];
  detail.welfare = Array.isArray(input.welfare)
    ? input.welfare.filter(Boolean)
    : [];
  const activeTime = Number(input.activeTime || input.actTime);
  if (activeTime) {
    if (!Number.isFinite(activeTime))
      throw new ProtocolError("Invalid job activeTime");
    detail.activeTime = activeTime;
  }
  return {
    messageId: idNumber("PendingResultId", selection.pendingId),
    jobDetail: detail,
  };
}
export interface ConfirmationOutcome {
  readonly status: "ADD_FRIEND" | "DELIVERED";
  readonly response: ApiResult;
  readonly input: ReturnType<typeof buildConfirmedResume>;
  /** ADD_FRIEND is App-accepted; it is not an attachment receipt. */
  readonly resumeAttachmentReceipt: "unknown";
}
export interface DeliveryRecordSelection {
  readonly id: ScopedId<"DeliveryRecordId">;
  readonly jobId: ScopedId<"DeliveryZpJobId">;
  readonly initialPeer: ScopedId<"RecordBossUid">;
  readonly raw: JsonRecord;
  readonly pending: PendingDeliverySelection;
  readonly association: RuntimeAssociation;
}
export function bindDeliveryRecord(
  rows: readonly JsonRecord[],
  id: ScopedId<"DeliveryRecordId">,
  pending: PendingDeliverySelection,
  proof: RuntimeAssociation,
): DeliveryRecordSelection {
  const provenance = association(proof, "confirmation -> delivery record");
  const raw = selectedRow(
      rows,
      idValue("DeliveryRecordId", id),
      "Delivery record",
    ),
    snapshot = record(raw.jobSnapshot);
  return Object.freeze({
    id,
    jobId: scopedId("DeliveryZpJobId", snapshot.jobId ?? raw.zpJobId),
    initialPeer: scopedId("RecordBossUid", raw.zpBossUid || snapshot.bossId),
    raw,
    pending,
    association: provenance,
  });
}
/** Mirrors records S -> E -> route order, before the independent ImPage lookup. */
export function enrichDeliveryRecords(
  rows: readonly JsonRecord[],
  lookup: readonly JsonRecord[],
): JsonRecord[] {
  const key = (row: JsonRecord) => {
    const value = row.zpJobId || record(row.jobSnapshot).jobId;
    return value ? scopedId("DeliveryZpJobId", value).value : undefined;
  };
  const snapshots = new Map<string, JsonRecord>();
  for (const row of lookup) {
    const id = key(row);
    if (id && row.jobSnapshot) snapshots.set(id, record(row.jobSnapshot));
  }
  return rows.map((row) => {
    const id = key(row),
      fresh = id ? snapshots.get(id) : undefined;
    if (!fresh) return { ...row };
    const old = record(row.jobSnapshot),
      merged = { ...old, ...fresh };
    for (const field of [
      "bossIcon",
      "bossName",
      "bossTitle",
      "title",
      "salary",
      "brand",
    ])
      merged[field] =
        String(fresh[field] || old[field] || "").trim() || undefined;
    return { ...row, jobSnapshot: merged };
  });
}

export class TaskDeliveryClient {
  constructor(readonly client: ZhijueAIClient) {}
  bindPending(
    rows: readonly JsonRecord[],
    id: ScopedId<"PendingResultId">,
    source: {
      taskId: ScopedId<"AiTaskId">;
      resultId: ScopedId<"AiTaskResultId">;
    },
    proof: RuntimeAssociation,
    options: RequestOptions = {},
  ): PendingDeliverySelection {
    return bindPendingDelivery(
      rows,
      id,
      source,
      proof,
      this.client.sessionOptions(options),
    );
  }
  tasks(
    conversation: ScopedId<"AiConversationId">,
    options: RequestOptions = {},
  ): Promise<ApiResult> {
    return this.client.request("GET", "/wapi/partners/v2/chat/task/list", {
      ...options,
      query: {
        ...options.query,
        conversationId: idValue("AiConversationId", conversation),
      },
    });
  }
  results(
    task: ScopedId<"AiTaskId">,
    options: RequestOptions = {},
  ): Promise<ApiResult> {
    return this.client.request("GET", "/wapi/partners/v2/chat/result/list", {
      ...options,
      query: { ...options.query, taskId: idValue("AiTaskId", task) },
    });
  }
  readResult(
    result: ScopedId<"AiTaskResultId">,
    options: RequestOptions = {},
  ): Promise<ApiResult> {
    return this.client.request("POST", "/wapi/partners/v2/chat/result/read", {
      ...options,
      body: { id: idNumber("AiTaskResultId", result) },
      retryOnUnauthorized: false,
    });
  }
  pending(
    options: RequestOptions & { startTime?: number; endTime?: number } = {},
  ): Promise<ApiResult> {
    const query = { ...options.query };
    for (const key of ["startTime", "endTime"] as const) {
      const value = options[key];
      if (value !== undefined && Number.isFinite(value) && value > 0)
        query[key] = value;
    }
    return this.client.request(
      "GET",
      "/wapi/partners/v2/chat/result/recentAiPendingDelivery",
      { ...options, query },
    );
  }
  async pendingByReport(
    report: ScopedId<"DailyReportId">,
    options: RequestOptions = {},
  ): Promise<{ report: ApiResult; pending: ApiResult | null }> {
    options = this.client.sessionOptions(options);
    const detail = await this.client.request<JsonRecord>(
      "GET",
      "/wapi/partners/v2/daily-report/by-id",
      { ...options, query: { id: idValue("DailyReportId", report) } },
    );
    const ids =
      record(detail.data?.detail).pendingConfirmedTaskResultIdList ?? [];
    if (!Array.isArray(ids))
      throw new ProtocolError(
        "Report did not contain the observed pendingConfirmedTaskResultIdList",
      );
    if (!ids.length) return { report: detail, pending: null };
    const values = ids.map(
      (value) => scopedId("ReportPendingResultId", value).value,
    );
    const pending = await this.client.request(
      "GET",
      "/wapi/partners/v2/daily-report/pending-delivery-jobs",
      { ...options, query: { ids: values.join(",") } },
    );
    return { report: detail, pending };
  }
  /** One explicit write. Never auto retries a confirmation or infers task/result IDs. */
  async confirm(
    selection: PendingDeliverySelection,
    options: RequestOptions = {},
  ): Promise<ConfirmationOutcome> {
    association(selection.association, "AI result -> pending confirmation row");
    return this.confirmPending(selection, options);
  }
  async confirmPending(
    selection: PendingRowSelection,
    options: RequestOptions = {},
  ): Promise<ConfirmationOutcome> {
    const current = this.client.sessionOptions(options).sessionEpoch;
    if (selection.sessionEpoch !== undefined) {
      if (current !== undefined && current !== selection.sessionEpoch)
        throw new SessionChangedError();
      options = { ...options, sessionEpoch: selection.sessionEpoch };
    } else if (current !== undefined)
      throw new RuntimeAssociationRequiredError(
        "pending selection -> original managed account scope",
      );
    const input = buildPendingRowConfirmation(selection);
    const response = await this.client.request(
      "POST",
      "/wapi/partners/zp/geek/sendConfirmedResume",
      {
        ...options,
        body: input,
        returnEnvelope: true,
        retryOnUnauthorized: false,
      },
    );
    const raw = record(response.raw),
      result = record(raw.result),
      status = result.status;
    if (raw.code !== 0 || (status !== "ADD_FRIEND" && status !== "DELIVERED"))
      throw new ConfirmationRejectedError(
        response.raw,
        typeof status === "string" ? status : undefined,
      );
    return { status, input, response, resumeAttachmentReceipt: "unknown" };
  }
  status(
    job: ScopedId<"PendingJobId">,
    options: RequestOptions = {},
  ): Promise<ApiResult> {
    return this.client.request(
      "POST",
      "/wapi/user/geek/delivery/listByJobIds",
      {
        ...options,
        body: { ids: [idNumber("PendingJobId", job)] },
        retryOnUnauthorized: false,
      },
    );
  }
  lookupRecordJob(
    job: ScopedId<"DeliveryZpJobId">,
    options: RequestOptions = {},
  ): Promise<ApiResult> {
    return this.client.request(
      "POST",
      "/wapi/user/geek/delivery/listByJobIds",
      {
        ...options,
        body: { ids: [idNumber("DeliveryZpJobId", job)] },
        retryOnUnauthorized: false,
      },
    );
  }
  records(
    source?: "manual" | "auto",
    options: RequestOptions = {},
  ): Promise<ApiResult> {
    return this.client.request("GET", "/wapi/user/geek/delivery/list", {
      ...options,
      query: {
        ...options.query,
        deliveryStatus: "ADD_FRIEND,DELIVERED",
        ...(source
          ? { deliveryBy: source === "manual" ? "MANUAL" : "AUTO" }
          : {}),
      },
    });
  }
}
