/** A delayed reassurance, not a processing stage or completion estimate. */
export const WAITING_THRESHOLDS = { longWait: 15_000 } as const;

export type WaitingPhase = "waiting" | "extended";

export function waitingPhase(elapsedMs: number): WaitingPhase {
  return elapsedMs >= WAITING_THRESHOLDS.longWait ? "extended" : "waiting";
}
