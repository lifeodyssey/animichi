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
import { makeScriptedTurnModel, makeSessionTurnParts, makeUserTranscript } from "./make-turn-parts.ts";
import { KUKI_STATION, LUCKY_STAR_ROUTE, SATTE, WASHINOMIYA } from "./catalog-payloads.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TranscriptRow } from "../../src/agent/session/turn-store.ts";
import { RecordingEnvelopeStorage } from "./recording-envelope-storage.ts";

const NOW = 1_000;
const PRICES = { inputUsdPerMtok: 1, outputUsdPerMtok: 2 };
export const RUN_ID = "run-1";

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

type StreamFn = NonNullable<Parameters<typeof makeScriptedTurnModel>[0]>;

/** A `CATALOG` binding answering the five procedures these turns can reach. */
function catalogBinding(resolveOutcome: object) {
  const answers: Record<string, object> = {
    "/catalog/resolve": resolveOutcome,
    "/catalog/points-by-bangumi-id": { rows: [WASHINOMIYA, SATTE], synced_at: "2026-06-20T00:00:00.000Z" },
    "/catalog/geocode": { candidates: [KUKI_STATION] },
    "/catalog/nearby": { rows: [WASHINOMIYA] },
    "/catalog/itinerary": LUCKY_STAR_ROUTE,
  };
  return {
    fetch: (request: Request) => {
      const body = answers[new URL(request.url).pathname] ?? {};
      return Promise.resolve(Response.json(body));
    },
  };
}

/** One model request as it left the loop: the system prompt it ran under, and
 * the context after `transformContext` shaped it. */
export interface ModelRequest {
  readonly prompt: string;
  readonly messages: readonly AgentMessage[];
}

/** Remember what pi actually sent. The system prompt is the constant every turn
 * of every session shares since #1379, and the messages are what compaction
 * shaped and the status bar was appended to on the way past (#1290, #1379). */
function requestRecording(streamFn: StreamFn, seen: ModelRequest[]): StreamFn {
  return (model, context, options) => {
    seen.push({ prompt: context.systemPrompt ?? "", messages: [...context.messages] as AgentMessage[] });
    return streamFn(model, context, options);
  };
}

/** The text of one context message, or "" when it is not a plain user message. */
export function userTextIn(message: AgentMessage | undefined): string {
  if (message === undefined || !("role" in message) || message.role !== "user") return "";
  return typeof message.content === "string" ? message.content : "";
}

/** Every `<agent_status>` bar one request's context carried (#1379). The claims
 * worth making about it are that there is exactly one and that it is last. */
export function statusBarsIn(request: ModelRequest): string[] {
  return request.messages.map(userTextIn).filter((text) => text.startsWith("<agent_status>"));
}

/** The last message of one request's context, as text. */
export function lastMessageIn(request: ModelRequest): string {
  return userTextIn(request.messages[request.messages.length - 1]);
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
  /** The run this turn drives; defaults to the session's only run. */
  readonly runId?: string;
  /** Every run the session still owes work for; defaults to just this one. */
  readonly queued?: readonly string[];
  /** The session transcript this run resumes from; defaults to one user row. */
  readonly transcript?: TranscriptRow[];
}

export interface EnvelopeTurnRun {
  readonly store: InMemoryTurnStore;
  readonly state: TurnState;
  /** Every model request this turn made, in order. */
  readonly requests: ModelRequest[];
  /** The system prompt each of this turn's model calls carried. */
  readonly prompts: string[];
  /** The `<agent_status>` bar each of those calls carried, "" when it carried
   * none — where the session's own facts arrive since #1379. */
  readonly statuses: string[];
}

/** The run one turn is driven against, with the lease and the settled steps an
 * earlier attempt could have left on it. */
export function makeEnvelopeTurnStore(parts: Partial<EnvelopeTurnParts> = {}): InMemoryTurnStore {
  const held = parts.leaseOwner;
  const store = new InMemoryTurnStore(
    {
      runId: parts.runId ?? RUN_ID, sessionId: "session-1", deadlineAt: NOW + 100_000,
      transcript: parts.transcript ?? makeUserTranscript(), steps: parts.steps ?? [],
      leaseOwner: held, leaseExpiresAt: held === undefined ? undefined : NOW + 100_000,
    },
    () => NOW,
  );
  store.stepWritesFail = parts.stepWritesFail ?? false;
  return store;
}

/** The turn itself, assembled the way `session-turn.ts` assembles the real one. */
function scriptedTurn(parts: EnvelopeTurnParts, store: InMemoryTurnStore, envelope: TurnEnvelope, requests: ModelRequest[]): DurableTurn {
  const binding = { CATALOG: catalogBinding(parts.resolveOutcome ?? RESOLVED_LUCKY_STAR) };
  const model = makeScriptedTurnModel(requestRecording(parts.streamFn, requests));
  return new DurableTurn({
    store: new EnvelopeStagingStore(store, envelope),
    model,
    toolbox: turnToolbox(binding, envelope.session, model),
    ...makeSessionTurnParts(envelope.session),
    systemPrompt: envelope.systemPrompt,
    prices: PRICES, emit: () => Promise.resolve(), owner: "do-1", now: () => NOW,
  });
}

/** Run one turn over the stored envelope, and hand back what it left behind. */
export async function runEnvelopeTurn(parts: EnvelopeTurnParts): Promise<EnvelopeTurnRun> {
  const store = parts.store ?? makeEnvelopeTurnStore(parts);
  const requests: ModelRequest[] = [];
  const runId = parts.runId ?? RUN_ID;
  const envelope = await TurnEnvelope.open({
    envelopes: new DurableEnvelopeStore(parts.storage),
    runId,
    queued: parts.queued ?? [runId],
    locale: "ja",
  });
  const state = await scriptedTurn(parts, store, envelope, requests).run(runId);
  await envelope.close(state);
  return {
    store, state, requests,
    prompts: requests.map((request) => request.prompt),
    statuses: requests.map((request) => statusBarsIn(request)[0] ?? ""),
  };
}
