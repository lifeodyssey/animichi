/**
 * One turn driven the way `session-turn.ts` drives it, with the session
 * envelope in front of it and behind it (card #1280).
 *
 * The loop, the step persistence and the catalog tools are all the REAL ones —
 * only the provider socket and the catalog binding are scripted — because "the
 * clarification turn N recorded is there for turn N+1" is a claim about the
 * whole round trip, not about a value object.
 */
import type { PersistedStep } from "../../src/agent/session/turn-store.ts";
import type { TurnState } from "../../src/agent/session/run-machine.ts";
import { DurableTurn } from "../../src/agent/session/durable-turn.ts";
import { DurableEnvelopeStore } from "../../src/agent/session/durable-envelope-store.ts";
import { EnvelopeStagingStore } from "../../src/agent/session/envelope-staging-store.ts";
import { TurnEnvelope } from "../../src/agent/session/turn-envelope.ts";
import { turnToolbox } from "../../src/agent/session/session-turn.ts";
import { InMemoryTurnStore } from "./in-memory-turn-store.ts";
import { makeScriptedModels, makeUserTranscript } from "./make-turn-parts.ts";
import { KUKI_STATION, SATTE, WASHINOMIYA } from "./catalog-payloads.ts";
import { RecordingEnvelopeStorage } from "./recording-envelope-storage.ts";

const NOW = 1_000;
const PRICES = { inputUsdPerMtok: 1, outputUsdPerMtok: 2 };
const RUN_ID = "run-1";

/** The catalog answer `resolve_anime` gets when one work matches the query. */
export const RESOLVED_LUCKY_STAR = {
  outcome: "resolved",
  match: { bangumi_id: "1", title: "らき☆すた", points_count: 2 },
};

/** The catalog answer that leaves the turn with a question only the user can settle. */
export const AMBIGUOUS_LUCKY_STAR = {
  outcome: "needs_disambiguation",
  candidates: [
    { bangumi_id: "1", title: "らき☆すた" },
    { bangumi_id: "2", title: "らき☆すた OVA" },
  ],
};

type StreamFn = NonNullable<Parameters<typeof makeScriptedModels>[0]>;

/** A `CATALOG` binding answering the five procedures these turns can reach. */
function catalogBinding(resolveOutcome: object) {
  const answers: Record<string, object> = {
    "/catalog/resolve": resolveOutcome,
    "/catalog/points-by-bangumi-id": { rows: [WASHINOMIYA, SATTE], synced_at: "2026-06-20T00:00:00.000Z" },
    "/catalog/geocode": { candidates: [KUKI_STATION] },
    "/catalog/nearby": { rows: [WASHINOMIYA] },
  };
  return {
    fetch: (request: Request) => {
      const body = answers[new URL(request.url).pathname] ?? {};
      return Promise.resolve(Response.json(body));
    },
  };
}

/** Remember the system prompt pi actually sent, which is where the stored facts
 * have to arrive for the next turn's model to act on them. */
function promptRecording(streamFn: StreamFn, seen: string[]): StreamFn {
  return (model, context, options) => {
    seen.push(context.systemPrompt ?? "");
    return streamFn(model, context, options);
  };
}

export interface EnvelopeTurnParts {
  readonly storage: RecordingEnvelopeStorage;
  readonly streamFn: StreamFn;
  /** What the catalog answers `resolve_anime` with. */
  readonly resolveOutcome?: object;
  /** Steps an earlier attempt already settled — the replay branch. */
  readonly steps?: PersistedStep[];
  /** Another incarnation already holding this run's lease. */
  readonly leaseOwner?: string;
  /** A store that refuses to write the step down. */
  readonly stepWritesFail?: boolean;
  /** The run this turn is a SECOND attempt at — the same `runs` row the first
   * attempt already settled, so the retry sees it terminal. */
  readonly store?: InMemoryTurnStore;
}

export interface EnvelopeTurnRun {
  readonly store: InMemoryTurnStore;
  readonly state: TurnState;
  /** The system prompt each of this turn's model calls carried. */
  readonly prompts: string[];
}

/** The run one turn is driven against, with the lease and the settled steps an
 * earlier attempt could have left on it. */
export function makeEnvelopeTurnStore(parts: Partial<EnvelopeTurnParts> = {}): InMemoryTurnStore {
  const held = parts.leaseOwner;
  const store = new InMemoryTurnStore(
    {
      runId: RUN_ID, sessionId: "session-1", deadlineAt: NOW + 100_000,
      transcript: makeUserTranscript(), steps: parts.steps ?? [],
      leaseOwner: held, leaseExpiresAt: held === undefined ? undefined : NOW + 100_000,
    },
    () => NOW,
  );
  store.stepWritesFail = parts.stepWritesFail ?? false;
  return store;
}

/** The turn itself, assembled the way `session-turn.ts` assembles the real one. */
function scriptedTurn(parts: EnvelopeTurnParts, store: InMemoryTurnStore, envelope: TurnEnvelope, prompts: string[]): DurableTurn {
  const binding = { CATALOG: catalogBinding(parts.resolveOutcome ?? RESOLVED_LUCKY_STAR) };
  return new DurableTurn({
    store: new EnvelopeStagingStore(store, envelope),
    models: makeScriptedModels(promptRecording(parts.streamFn, prompts)),
    toolbox: turnToolbox(binding, envelope.session),
    systemPrompt: envelope.systemPrompt,
    prices: PRICES, emit: () => Promise.resolve(), owner: "do-1", now: () => NOW,
  });
}

/** Run one turn over the stored envelope, and hand back what it left behind. */
export async function runEnvelopeTurn(parts: EnvelopeTurnParts): Promise<EnvelopeTurnRun> {
  const store = parts.store ?? makeEnvelopeTurnStore(parts);
  const prompts: string[] = [];
  const envelope = await TurnEnvelope.open(new DurableEnvelopeStore(parts.storage), RUN_ID, "ja");
  const state = await scriptedTurn(parts, store, envelope, prompts).run(RUN_ID);
  await envelope.close(state);
  return { store, state, prompts };
}
