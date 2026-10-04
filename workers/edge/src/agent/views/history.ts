import { historySteps } from "./history-steps.ts";
import { historyOperations } from "./history-operations.ts";
import type { GetSessionHistoryResponse, SessionRunStatus } from "@animichi/contract/session-history-contract";
import { RunFailureReason } from "@animichi/contract/session-history-contract";
import { NeonStorage } from "@animichi/pi-session-neon";
import { branchTip, laneState, operationResult, type Session, type Storage, type UsageRow } from "@earendil-works/pi-agent-core/harness/session";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/pi-agent-core/harness/context";
import type { AdmissionDatabase } from "../admission/types.ts";
import { SecretScrub } from "../egress/secret-scrub.ts";
import { projectHistory } from "./history-record.ts";

export interface HistoryPage { offset: number; limit: number }
const scrub = new SecretScrub();

/** Direct native Storage reads only: browsing never constructs a harness or wakes a Durable Object. */
export async function readNativeHistory(db: AdmissionDatabase, sessionId: string, identityId: string, page: HistoryPage): Promise<GetSessionHistoryResponse | null> {
  const owners = await db.runtime().query(db.raw.sql`SELECT user_id AS owner FROM sessions WHERE id = ${sessionId}`.returnsRow({ owner: { codecId: "pg/text@1", nullable: true } }).build());
  if (owners[0]?.owner !== identityId) return null;
  const storage = new NeonStorage(db, { sessionId });
  try {
    const history = await readHistoryStorage(storage, page, BACKGROUND_CONTEXT);
    return { ...history, run: await admittedRun(db, history.run ?? null) };
  } finally { await storage.close(BACKGROUND_CONTEXT); }
}

/** A terminal run keeps the reason the business record committed; the browser never sees free text. */
export function publicRunReason(run: SessionRunStatus | null, rejectionReason: string | null | undefined): SessionRunStatus | null {
  if (run?.status !== "failed" || rejectionReason === null || rejectionReason === undefined) return run;
  const parsed = RunFailureReason.safeParse(rejectionReason);
  return parsed.success ? { run_id: run.run_id, status: run.status, reason: parsed.data } : run;
}

async function admittedRun(db: AdmissionDatabase, run: SessionRunStatus | null): Promise<SessionRunStatus | null> {
  if (run?.status !== "failed") return run;
  const row = await db.orm.public.AgentAdmission.where({ operationId: run.run_id }).first();
  return publicRunReason(run, row?.rejectionReason);
}

export async function readHistoryStorage(storage: Storage | Session, page: HistoryPage, context: Context): Promise<GetSessionHistoryResponse> {
  const tip = await storage.getValue(branchTip("main"), context);
  const entries = tip?.value ? await storage.scanBranch({ start: tip.value, order: "oldestFirst" }, context) : [];
  const operations = await historyOperations(storage, entries, context);
  const record = projectHistory(entries, await usageRows(storage, context), operations, scrub);
  const visible = record.messages.slice(page.offset, page.offset + page.limit);
  const next = page.offset + page.limit;
  return { messages: visible.map((item) => item.message), revision: entries.at(-1)?.seq ?? 0,
    next_offset: record.messages.length > next && next <= 1000 ? next : null, run: await historyRun(storage, context),
    steps: historySteps(entries, visible.map((item) => item.entry)), tool_results: record.toolResults, model_calls: record.modelCalls };
}

/** A `Session` capability has no usage scan; only a full `Storage` records per-call usage. */
async function usageRows(storage: Storage | Session, context: Context): Promise<readonly UsageRow[]> {
  return "scanUsage" in storage ? await storage.scanUsage({ order: "asc" }, context) : [];
}

async function historyRun(storage: Storage | Session, context: Context): Promise<SessionRunStatus | null> {
  const state = (await storage.getValue(laneState("main"), context))?.value;
  const id = state?.currentOperationId ?? state?.lastOperationId;
  if (!id) return null;
  const result = (await storage.getValue(operationResult(id), context))?.value;
  if (!result) return { run_id: id, status: "running" };
  if (result.status === "completed") return { run_id: id, status: "succeeded" };
  return { run_id: id, status: "failed", reason: result.status === "aborted" ? "cancelled" : "internal_error" };
}
