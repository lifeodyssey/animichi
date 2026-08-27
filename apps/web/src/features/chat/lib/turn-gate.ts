import type { ChatStatus } from "ai";

/**
 * The one status gate every send entry point shares (W1 #1220): text input,
 * clarify-candidate pick, and point-selection recompute all refuse to fire
 * while a turn is in flight, so a click during a live stream can never race
 * the stream's own turn.
 */
export function isTurnActive(status: ChatStatus): boolean {
  return status === "submitted" || status === "streaming";
}

/** Wrap a send entry point so it is dropped, not raced, while a turn runs. */
export function gatedTurnEntry<Args extends unknown[]>(
  status: ChatStatus,
  entry: (...args: Args) => void,
): (...args: Args) => void {
  return (...args: Args) => {
    if (!isTurnActive(status)) entry(...args);
  };
}
