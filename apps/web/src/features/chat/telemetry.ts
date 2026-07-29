/** Frontend-only turn timing signals (first-token SLO is gated server-side). */
export type ChatTimingKind = "first_token" | "turn";

export interface ChatTimingEvent {
  readonly kind: ChatTimingKind;
  readonly ms: number;
}

export type ChatTimingReporter = (event: ChatTimingEvent) => void;

const latest: Partial<Record<ChatTimingKind, number>> = {};

/** Record a turn timing signal: kept in-memory and marked on the perf timeline. */
export function recordChatTiming(event: ChatTimingEvent): void {
  latest[event.kind] = event.ms;
  performance.mark(`chat:${event.kind}`);
}

export function lastChatTiming(kind: ChatTimingKind): number | undefined {
  return latest[kind];
}

/** Human-readable "9.2s" label for a settled turn's elapsed time. */
export function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
