/**
 * One deterministic-selection turn, assembled the way `session-turn.ts`
 * assembles a real one (card #1288).
 *
 * The store keeps the DDL's invariants (`in-memory-turn-store.ts`) and the
 * catalog counts its calls, so "the step was replayed" is measured as "the
 * catalog was not asked again" rather than asserted about a flag — the same
 * instrument `make-turn-parts.ts`'s `CountingSpotLookup` gives the model loop.
 * Named for what it builds, per .claude/rules/naming-ownership.md.
 */
import type { Itinerary, LatLng, Point, SearchResult } from "@animichi/contract";
import { DurableTurn } from "../../src/agent/session/durable-turn.ts";
import { SessionEnvelope } from "../../src/agent/session/session-envelope.ts";
import { TurnAnswering } from "../../src/agent/session/turn-answer.ts";
import { TurnCatalogSession } from "../../src/agent/session/turn-catalog-session.ts";
import type { TurnFrame } from "../../src/agent/session/turn-frames.ts";
import type { PersistedStep } from "../../src/agent/session/turn-store.ts";
import { EMPTY_TOOLBOX } from "../../src/agent/session/turn-toolbox.ts";
import { answerSelection } from "../../src/agent/selection/turn-selection.ts";
import type { SelectionRequest } from "../../src/agent/selection/selection-request.ts";
import { CatalogUnavailableError, type CatalogClient } from "../../src/agent/tools/catalog-client.ts";
import type { OrderedCandidate } from "../../src/agent/tools/catalog-tool-session.ts";
import { InMemoryTurnStore } from "./in-memory-turn-store.ts";
import type { TurnModel } from "../../src/agent/session/turn-model.ts";
import { makeScriptedTurnModel, makeUserTranscript } from "./make-turn-parts.ts";

export const SELECTION_RUN_ID = "run-1";
const OWNER = "do-incarnation-1";
const NOW = 1_000;

/** What the catalog answers a selection turn, per work and for the route. */
export interface SelectionCatalogScript {
  readonly works?: Readonly<Record<string, SearchResult>>;
  readonly nearby?: Point[];
  readonly itinerary?: Itinerary;
}

/** A counting catalog: only the three procedures a selection can reach. */
export class CountingSelectionCatalog implements CatalogClient {
  fetched: string[] = [];
  planned: string[][] = [];
  searched: LatLng[] = [];
  readonly #script: SelectionCatalogScript;

  constructor(script: SelectionCatalogScript) {
    this.#script = script;
  }

  resolve(): Promise<never> {
    return Promise.reject(new CatalogUnavailableError("resolve: not reachable from a selection"));
  }

  geocode(): Promise<never> {
    return Promise.reject(new CatalogUnavailableError("geocode: not reachable from a selection"));
  }

  pointsByBangumiId(bangumiId: string): Promise<SearchResult> {
    this.fetched.push(bangumiId);
    const answer = this.#script.works?.[bangumiId];
    if (answer === undefined) return Promise.reject(new CatalogUnavailableError("points: none scripted"));
    return Promise.resolve(answer);
  }

  nearby(around: LatLng): Promise<Point[]> {
    this.searched.push(around);
    const rows = this.#script.nearby;
    if (rows === undefined) return Promise.reject(new CatalogUnavailableError("nearby: none scripted"));
    return Promise.resolve(rows);
  }

  planItinerary(pointIds: string[]): Promise<Itinerary> {
    this.planned.push(pointIds);
    const route = this.#script.itinerary;
    if (route === undefined) return Promise.reject(new CatalogUnavailableError("itinerary: none scripted"));
    return Promise.resolve(route);
  }
}

/** What one case sets up before the alarm runs. */
export interface SelectionTurnSeed {
  /** The selection this run IS, or `null` for an ordinary model turn — which
   * only the eligibility cases need, as the control they are judged against. */
  readonly selection: SelectionRequest | null;
  /** What this deployment resolved as its model. `null` is the deployment with
   * a `CATALOG` binding and no provider key (#1296 review). */
  readonly model?: TurnModel | null;
  /** `runs.payer = 'byok'` — a run whose credential died with the incarnation
   * that held it. */
  readonly callerKeyed?: boolean;
  readonly script: SelectionCatalogScript;
  /** The question the session already asked, if it asked one. */
  readonly pending?: { reason: string; candidates: OrderedCandidate[] };
  /** Steps an earlier, evicted attempt already settled. */
  readonly steps?: PersistedStep[];
}

/** Everything a case reads back after the alarm. */
export interface SelectionTurnHarness {
  readonly store: InMemoryTurnStore;
  readonly catalog: CountingSelectionCatalog;
  readonly session: TurnCatalogSession;
  readonly frames: TurnFrame[];
  readonly turn: DurableTurn;
}

function seededEnvelope(seed: SelectionTurnSeed): SessionEnvelope {
  const { pending } = seed;
  if (pending === undefined) return SessionEnvelope.empty;
  return SessionEnvelope.empty.withClarification(pending.reason, pending.candidates);
}

/** One selection turn, ready to be driven by `turn.run(SELECTION_RUN_ID)`. */
export function makeSelectionTurn(seed: SelectionTurnSeed): SelectionTurnHarness {
  const now = () => NOW;
  const store = new InMemoryTurnStore(
    {
      runId: SELECTION_RUN_ID,
      sessionId: "session-1",
      deadlineAt: NOW + 100_000,
      transcript: makeUserTranscript("らき☆すた"),
      steps: seed.steps ?? [],
      selection: seed.selection,
      callerKeyed: seed.callerKeyed ?? false,
    },
    now,
  );
  const session = new TurnCatalogSession({ locale: "ja", envelope: seededEnvelope(seed) });
  const catalog = new CountingSelectionCatalog(seed.script);
  const frames: TurnFrame[] = [];
  const emit = (pushed: readonly TurnFrame[]): Promise<void> => {
    frames.push(...pushed);
    return Promise.resolve();
  };
  const turn = new DurableTurn({
    store,
    model: seed.model === undefined ? makeScriptedTurnModel() : seed.model,
    toolbox: EMPTY_TOOLBOX,
    answering: new TurnAnswering(session),
    memory: session,
    refs: session,
    selection: (request, steps) => answerSelection({ catalog, session, steps, emit }, request),
    // A modelless deployment offers no tools either, which is what
    // `configuredTurn` does with the same `null` (`session-turn.ts`).
    systemPrompt: "test",
    prices: { inputUsdPerMtok: 1, outputUsdPerMtok: 2 },
    emit,
    owner: OWNER,
    now,
  });
  return { store, catalog, session, frames, turn };
}
