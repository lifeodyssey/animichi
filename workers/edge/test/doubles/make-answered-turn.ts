/**
 * One real turn driven to an ANSWER, with the frames it pushed (#1283).
 *
 * The pi loop, `TurnSteps`, the catalog tools and the `respond` tool are all the
 * real ones — only the provider socket and the `CATALOG` binding are scripted —
 * because "the answer sits where the captures put it" is a claim about the whole
 * round trip, not about a projection called by hand.
 */
import assert from "node:assert/strict";
import { DurableTurn } from "../../src/agent/session/durable-turn.ts";
import type { TurnState } from "../../src/agent/session/run-machine.ts";
import { TurnCatalogSession } from "../../src/agent/session/turn-catalog-session.ts";
import type { TurnFrame } from "../../src/agent/session/turn-frames.ts";
import { turnToolbox } from "../../src/agent/session/session-turn.ts";
import { InMemoryTurnStore } from "./in-memory-turn-store.ts";
import { LUCKY_STAR_ROUTE, SATTE, WASHINOMIYA } from "./catalog-payloads.ts";
import { makeScriptedTurnModel, makeSessionTurnParts, makeUserTranscript } from "./make-turn-parts.ts";
import { makeSequencedToolCallsStreamFn, type ScriptedToolCall } from "./pi-provider-double.ts";

const NOW = 1_000;
/** The run every answered turn here is driven as — the run its refs name. */
export const ANSWERED_RUN_ID = "run-1";
const RUN_ID = ANSWERED_RUN_ID;
const PRICES = { inputUsdPerMtok: 1, outputUsdPerMtok: 2 };

type StreamFn = NonNullable<Parameters<typeof makeScriptedTurnModel>[0]>;

/** The catalog answer `resolve_anime` gets when one work matches. */
export const RESOLVED_LUCKY_STAR = {
  outcome: "resolved",
  match: { bangumi_id: "1", title: "らき☆すた", points_count: 2 },
};

/** The catalog answer that leaves the turn with a question for the user. */
export const AMBIGUOUS_LUCKY_STAR = {
  outcome: "needs_disambiguation",
  candidates: [
    { bangumi_id: "1", title: "らき☆すた" },
    { bangumi_id: "2", title: "らき☆すた OVA" },
  ],
};

function catalogBinding(resolveOutcome: object): { fetch: (request: Request) => Promise<Response> } {
  const answers: Record<string, object> = {
    "/catalog/resolve": resolveOutcome,
    "/catalog/points-by-bangumi-id": { rows: [WASHINOMIYA, SATTE], synced_at: "2026-06-20T00:00:00.000Z" },
    "/catalog/itinerary": LUCKY_STAR_ROUTE,
  };
  return {
    fetch: (request) => {
      const body = answers[new URL(request.url).pathname];
      assert.ok(body, `the turn called an unscripted catalog procedure: ${request.url}`);
      return Promise.resolve(Response.json(body));
    },
  };
}

/** What one driven turn left behind. */
export interface AnsweredTurn {
  readonly frames: TurnFrame[];
  readonly session: TurnCatalogSession;
  readonly store: InMemoryTurnStore;
  readonly state: TurnState;
}

/** The calls the model makes, and what the catalog says when asked to resolve. */
export interface AnsweredTurnParts {
  readonly calls?: readonly ScriptedToolCall[];
  readonly resolveOutcome?: object;
  /** A provider socket of the case's own, for the turns that never answer. */
  readonly streamFn?: StreamFn;
}

/** Drive one turn over the real loop and collect every frame it pushed. */
export async function makeAnsweredTurn(parts: AnsweredTurnParts): Promise<AnsweredTurn> {
  const frames: TurnFrame[] = [];
  const store = new InMemoryTurnStore(
    { runId: RUN_ID, sessionId: "session-1", deadlineAt: NOW + 100_000, transcript: makeUserTranscript(), steps: [] },
    () => NOW,
  );
  const session = new TurnCatalogSession({ runId: RUN_ID, locale: "ja" });
  const model = makeScriptedTurnModel(parts.streamFn ?? makeSequencedToolCallsStreamFn(parts.calls ?? []));
  const state = await new DurableTurn({
    store,
    model,
    toolbox: turnToolbox({ CATALOG: catalogBinding(parts.resolveOutcome ?? RESOLVED_LUCKY_STAR) }, session, model),
    ...makeSessionTurnParts(session),
    systemPrompt: "test",
    prices: PRICES,
    emit: (pushed) => {
      frames.push(...pushed);
      return Promise.resolve();
    },
    owner: "do-1",
    now: () => NOW,
  }).run(RUN_ID);
  return { frames, session, store, state };
}
