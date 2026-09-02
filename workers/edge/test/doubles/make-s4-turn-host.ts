// The W0-S4 (#1247) world under test: one Durable Object incarnation's three
// surfaces, wired to a truthful run store, a Map-backed state and a clock only
// `sleep` moves.
//
// `makeS4TurnHost` builds a FRESH incarnation over storage the caller supplies,
// which is what lets a test model an eviction: build a second host over the same
// `MemoryTurnHostState` and the same store, and it starts with an empty
// subscriber map and no in-memory queue, exactly like a restarted instance.
//
// The numbers are the spec's: three tool calls holding 100s each is the
// deliberate five-minute turn of §四 S4, run under a seven-minute spike-only
// deadline (the floor is six).

import { makeTurnHost, type TurnHost } from "../../spike/pi/src/turn-host.ts";
import { AdvancingClock } from "./advancing-clock.ts";
import { InMemoryRunStore } from "./in-memory-run-store.ts";
import { MemoryTurnHostState } from "./memory-turn-host-state.ts";

export const TURN_STARTED_AT = Date.UTC(2026, 8, 3, 9, 0, 0);
export const HOLD_MS = 100_000;
export const TOOL_CALLS = 3;
export const FIVE_MINUTES_MS = HOLD_MS * TOOL_CALLS;
export const SPIKE_DEADLINE_MS = 7 * 60_000;
export const SESSION_ID = "spike-s4-session";

export interface S4TurnHost {
  host: TurnHost;
  store: InMemoryRunStore;
  clock: AdvancingClock;
  state: MemoryTurnHostState;
}

/** A fresh incarnation. Pass an existing world's parts to model a restart. */
export function makeS4TurnHost(previous?: S4TurnHost): S4TurnHost {
  const clock = previous?.clock ?? new AdvancingClock(TURN_STARTED_AT);
  const store = previous?.store ?? new InMemoryRunStore(clock.now);
  const state = previous?.state ?? new MemoryTurnHostState();
  return { host: makeTurnHost(state, store, clock.now, clock.sleep), store, clock, state };
}

export interface LongTurnBody {
  deadlineMs: number;
  holdMs: number;
  toolCalls: number;
  crashBeforePersistStep?: number;
  failAtStep?: number;
}

export function longTurnRequest(overrides: Partial<LongTurnBody> = {}): Request {
  const body: LongTurnBody = {
    deadlineMs: SPIKE_DEADLINE_MS,
    holdMs: HOLD_MS,
    toolCalls: TOOL_CALLS,
    ...overrides,
  };
  return new Request("https://spike.test/turn/long?session=" + SESSION_ID, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The run id the host hands back in the response header the script also reads. */
export function runIdOfResponse(response: Response): string {
  return response.headers.get("x-spike-run-id") ?? "";
}
