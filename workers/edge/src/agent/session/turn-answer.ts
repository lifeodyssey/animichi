/**
 * The typed final output of one turn, and the tool the model submits it with
 * (card #1283, spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §二
 * "结构化输出：submit_result 工具 + 校验 throw 回喂 + terminate").
 *
 * DECISION — (b) a final tool, NOT a JSON-schema-constrained answer. Measured
 * against the installed kernel (`@earendil-works/pi-*` 0.84.4) rather than
 * chosen:
 *   - pi has no seam for (a). The `Context` its `streamFn` receives carries
 *     exactly `{systemPrompt, messages, tools}` (`pi-ai/dist/types.d.ts`;
 *     confirmed by running the real `Agent` against the provider double and
 *     printing the context keys), and the `openai-completions` adapter this
 *     turn streams through never emits `response_format` — its only constrained
 *     sampling is per TOOL (`resolveJsonSchemaStrictSampling`,
 *     `dist/api/openai-completions.js:1162`). A constrained final answer would
 *     mean patching the adapter, not configuring it.
 *   - (b) round-trips on this kernel and costs no extra provider call: the same
 *     probe submitted `{kind, message}` through a final tool and
 *     `shouldStopAfterTurn` ended the loop inside the SAME model turn (1
 *     provider stream call, no error).
 *   - mimo-v2.5 direct is measured on tools, not on structured output. W0-S2
 *     (spec Appendix B) ran 19 direct cases — including `supportsStrictMode` at
 *     both values — and every one completed a tool round trip with streaming
 *     usage. So the mechanism this card leans on is the one that has evidence.
 * Python landed in the same place from the other side: pydantic-ai's union
 * `output_type` is implemented as final-result TOOLS, so `respond` is that
 * mechanism named rather than a new one.
 *
 * WHAT THE MODEL MAY AUTHOR is deliberately small — prose and a KIND. The
 * envelope (`intent`, `data`, `status`, `ui`) is projected from server state by
 * `turn-answer-part.ts`, which is `_CompactOutput`'s rule ("Forbid the retired
 * model-authored intent, data, and UI envelopes") kept: a model that could name
 * `search_bangumi` could name a search it never ran.
 *
 * THE THROW IS THE VALIDATION LOOP. pi turns a tool's throw into an error
 * result the model reads, so a kind with no evidence behind it — "search" with
 * no stored result, "clarify" with nothing pending — is fed back and the model
 * answers again. That is the spec's "校验 throw 回喂", and it is the second
 * reason (a) was not viable: a constrained decode has nowhere to put a
 * server-side rejection.
 */
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { AnswerKind, AnswerParameters } from "@animichi/contract/agent-tool-parameters";
import {
  ANSWER_TOOL_NAME,
  ANSWER_TOOL_SCHEMA,
  type ChatResponseIntent,
} from "@animichi/contract/agent-tool-schemas";
import type { ItineraryPayload, SearchResultPayload } from "../tools/catalog-tool-session.ts";
import type { PendingClarification } from "./session-envelope.ts";
import type { TurnCatalogSession } from "./turn-catalog-session.ts";
import { toolParameters } from "../tools/tool-schema-bridge.ts";

/** The `respond` tool's parameters, carrying the type the contract inferred. */
const answerParameters = toolParameters<AnswerParameters>(ANSWER_TOOL_SCHEMA);

/**
 * The server state one answer publishes, as ONE tagged value rather than three
 * nullable fields. The tag is what keeps the `data` member and the status that
 * member implies derivable in a single walk (`turn-answer-part.ts`), and it
 * makes "a route answer carrying a search too" unrepresentable instead of
 * merely unintended.
 */
export type AnswerPayload =
  | { readonly of: "search"; readonly search: SearchResultPayload }
  | { readonly of: "route"; readonly itinerary: ItineraryPayload }
  | { readonly of: "clarification"; readonly clarification: PendingClarification }
  | { readonly of: "prose" };

/**
 * One turn's answer: exactly one `ChatResponseDataPart`, held as the intent the
 * server derived, the prose the model wrote, and the payload that fills `data`.
 */
export interface TurnAnswer {
  readonly intent: ChatResponseIntent;
  readonly message: string;
  readonly payload: AnswerPayload;
}

/**
 * A turn that has not answered yet. It is never published — `TurnAttempt`
 * replaces it before its pi run returns, and a run that throws instead takes the
 * failure path, whose frames carry no answer at all — but it keeps `answer` a
 * value rather than a null every reader has to re-check.
 */
export const UNANSWERED_TURN: TurnAnswer = {
  intent: "general_qa",
  message: "",
  payload: { of: "prose" },
};

/** A kind the turn's own state does not support: fed back for another try. */
export class AnswerRejected extends Error {}

/** The newest result the turn stored, which is the one an answer is about. */
function latest<T>(stored: ReadonlyMap<string, T>): T | null {
  return [...stored.values()].at(-1) ?? null;
}

/** Which search a `search` answer means — the model never names it (Python's
 * `runtime_stage` read it off the run's own steps for the same reason). */
function searchIntent(payload: SearchResultPayload): ChatResponseIntent {
  return payload.kind === "nearby" ? "search_nearby" : "search_bangumi";
}

function reject(kind: AnswerKind, missing: string): never {
  throw new AnswerRejected(`kind=${kind} needs ${missing}; this turn produced none`);
}

/** The route this turn planned, or a rejection to feed back. */
function routeAnswered(session: TurnCatalogSession): Omit<TurnAnswer, "message"> {
  const itinerary = latest(session.itineraries) ?? reject("route", "a planned route");
  return { intent: "plan_route", payload: { of: "route", itinerary } };
}

/** The search this turn ran, or a rejection to feed back. */
function searchAnswered(session: TurnCatalogSession): Omit<TurnAnswer, "message"> {
  const search = latest(session.searchResults) ?? reject("search", "a stored search result");
  return { intent: searchIntent(search), payload: { of: "search", search } };
}

/** The clarification the session has open, with the model's reason checked
 * against it — a reason the pending outcome does not carry is a reason the
 * model invented. */
function clarifyAnswered(session: TurnCatalogSession, reason: string | undefined): Omit<TurnAnswer, "message"> {
  const clarification = session.envelope.pendingClarification;
  if (clarification === null) reject("clarify", "an open clarification");
  if (reason !== clarification.reason) {
    throw new AnswerRejected(`reason must be "${clarification.reason}", the pending outcome's own`);
  }
  return { intent: "clarify", payload: { of: "clarification", clarification } };
}

const PROSE_INTENTS: Record<"greeting" | "qa", ChatResponseIntent> = {
  greeting: "greet_user",
  qa: "general_qa",
};

/** What this turn produced, for the kind the model claims it produced. */
function answeredFor(params: AnswerParameters, session: TurnCatalogSession): Omit<TurnAnswer, "message"> {
  const { kind } = params;
  if (kind === "route") return routeAnswered(session);
  if (kind === "search") return searchAnswered(session);
  if (kind === "clarify") return clarifyAnswered(session, params.reason);
  return { intent: PROSE_INTENTS[kind], payload: { of: "prose" } };
}

/** One submission resolved against what this turn actually produced. */
function answerFor(params: AnswerParameters, session: TurnCatalogSession): TurnAnswer {
  return { ...answeredFor(params, session), message: params.message };
}

/**
 * How one turn answers: the `respond` tool it may call, and the typed output
 * that call becomes.
 *
 * It also carries the end-of-run repair Python's `animichi_runner` did and
 * #1280 had to defer — clear the pending clarification unless the answer IS a
 * clarification. It runs HERE, at `close()`, rather than at
 * `TurnEnvelope.close()`: the envelope is staged inside the settlement
 * transaction (`EnvelopeStagingStore`), so a repair made after that would be
 * written to a staging nobody re-reads, and the alarm's retry would promote the
 * unrepaired one.
 */
export class TurnAnswering {
  readonly #session: TurnCatalogSession;
  #submitted: TurnAnswer | null = null;

  constructor(session: TurnCatalogSession) {
    this.#session = session;
  }

  /** True once the model has submitted an answer: the loop may stop. */
  get submitted(): boolean {
    return this.#submitted !== null;
  }

  /** The tool the model ends its turn by calling. */
  tool(): AgentTool<typeof answerParameters, JsonValue> {
    return {
      name: ANSWER_TOOL_NAME,
      label: "Answer the user",
      description:
        "Submit the reply that ends this turn. Call it exactly once, after every tool you needed.",
      parameters: answerParameters,
      execute: (_id: string, params: AnswerParameters) => this.#accept(params),
    };
  }

  /**
   * What the turn answered — the submission, or prose the model streamed
   * without calling `respond` at all.
   *
   * ONLY A SUBMISSION REPAIRS THE ENVELOPE. Python's rule reads "unless the
   * output was a `ClarifyResponseModel`", but its `output_type` union made a
   * typed output the only way a run could terminate at all — a model that
   * merely talked never reached that branch (`_capped_partial_result`). pi has
   * no such guarantee: its loop ends cleanly on a turn with no tool call, so
   * treating "did not answer" as "answered something that was not a
   * clarification" would let a model that asks its clarifying question in PROSE
   * wipe the very clarification the tool just set. A turn that voiced nothing
   * leaves the session exactly as it found it.
   */
  close(streamed: string): TurnAnswer {
    const submitted = this.#submitted;
    if (submitted === null) return { ...UNANSWERED_TURN, message: streamed };
    if (submitted.intent !== "clarify") this.#session.clearPendingClarification();
    return submitted;
  }

  /**
   * Resolve the submission against what the turn produced — the resolution IS
   * the validation, so a kind with nothing behind it throws here and pi feeds
   * the throw back. It is resolved at ACCEPT time and held, because the state
   * it is resolved against is the state the model just saw.
   */
  #accept(params: AnswerParameters): Promise<AgentToolResult<JsonValue>> {
    this.#submitted = answerFor(params, this.#session);
    return Promise.resolve({ content: [{ type: "text", text: "Answer accepted." }], details: null });
  }
}
