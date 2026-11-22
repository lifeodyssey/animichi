import { persistPermanentRejection } from "../admission/permanent-rejection.ts";
import { remainingTurnBudget, turnDeadline, type TurnWindow } from "./turn-deadline.ts";
import type { AdmissionDatabase } from "../admission/types.ts";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";

/** The lane surface one turn's budget reads: the SDK's durable acceptance witness and the cancellation that ends the turn. */
export interface TurnLane {
  inspectExecution(context: Context): Promise<{ readonly current: { readonly id: string; readonly startedAt: number } | null }>;
  requestAbort(operationId: string, context: Context): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: Error }>;
}

/** The stream options one model request carries, as far as the budget reads them. */
export interface ModelRequestBoundary {
  readonly streamOptions: { readonly timeoutMs?: number };
}

/**
 * One live drive's non-renewable turn budget (#1416): it opens from the SDK's durable
 * acceptance witness, clamps every model request to what remains of the deadline, and
 * ends the turn durably — the business reason commits before the SDK cancellation, and
 * no failed write may suppress that cancellation.
 */
export class TurnBudget {
  #window?: TurnWindow;

  constructor(private readonly sessionId: string, private readonly budgetMs: number, private readonly business?: AdmissionDatabase) {}

  /** Open from the durable acceptance witness; a budget already spent ends the turn here, before any request exists. */
  async open(lane: TurnLane, operationId: string, context: Context) {
    const window = await this.#windowFor(lane, operationId, context);
    this.#window = window;
    if (window && remainingTurnBudget(window.deadlineAt, Date.now()) === 0) await this.#expire(lane, window, context);
  }

  /** The model-request boundary: no request outlives the budget, and a spent budget ends the turn here. */
  async boundModelRequest(lane: TurnLane, event: ModelRequestBoundary, context: Context) {
    const window = this.#window;
    if (!window) return undefined;
    const budget = remainingTurnBudget(window.deadlineAt, Date.now());
    if (budget === 0) { await this.#expire(lane, window, context); return undefined; }
    const configured = event.streamOptions.timeoutMs;
    return { streamOptions: { timeoutMs: configured === undefined ? budget : Math.min(configured, budget) } };
  }

  async #windowFor(lane: TurnLane, operationId: string, context: Context): Promise<TurnWindow | undefined> {
    const current = (await lane.inspectExecution(context)).current;
    return current?.id === operationId ? { operationId, deadlineAt: turnDeadline(current.startedAt, this.budgetMs) } : undefined;
  }

  /** One terminal path for both boundaries; the durable business reason precedes the SDK cancellation, which no failed write may suppress. */
  async #expire(lane: TurnLane, window: TurnWindow, context: Context) {
    const operation = { sessionId: this.sessionId, operationId: window.operationId };
    let abort: Awaited<ReturnType<TurnLane["requestAbort"]>>;
    try {
      if (this.business) await persistPermanentRejection(this.business, operation, "deadline_exceeded");
    } finally { abort = await lane.requestAbort(window.operationId, context); }
    if (!abort.ok) throw abort.error;
  }
}
