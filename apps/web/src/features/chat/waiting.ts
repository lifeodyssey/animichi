/** Elapsed-time thresholds (ms) that escalate the turn-waiting ritual. */
export const WAITING_THRESHOLDS = { pipeline: 1000, mood: 4000 } as const;

/** B2a running <1s · B2b pipeline 1-4s · B2c mood card ≥4s (states spec §B). */
export type WaitingPhase = "B2a" | "B2b" | "B2c";

export function waitingPhase(elapsedMs: number): WaitingPhase {
  if (elapsedMs >= WAITING_THRESHOLDS.mood) return "B2c";
  if (elapsedMs >= WAITING_THRESHOLDS.pipeline) return "B2b";
  return "B2a";
}
