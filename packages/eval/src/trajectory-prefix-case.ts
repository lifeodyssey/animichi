/**
 * The frozen prefix one exported case carries, read off its own `inputs`
 * (E-1 #1380, spec §十 10.1).
 *
 * NO NEW DATASET FORMAT. `AgentInput.seeded_pending` is already exported —
 * `Mapping[str, object] | None` on the Python side, an open map here — and the
 * five `phase1c_selection_v1` cases are exactly the ones that carry it. This
 * module reads that field; nothing was added to the canonical datasets and no
 * fixture was re-exported.
 *
 * WHAT THE FIELD CANNOT CARRY, AND WHAT IS DONE ABOUT IT. `seeded_pending` is
 * the STATE the previous turn left — a reason, an ordered candidate list and a
 * revision — and says nothing about the turn that left it, because Python never
 * took one: `eval_harness._selection_task` set that state directly on an
 * in-process session. Over HTTP a session's state is the trace of its turns, so
 * a turn has to exist, and the only honest one is the MINIMAL turn consistent
 * with the state: the tool that can raise this clarification, called with the
 * work or place the question is about, answered with the offer the question
 * makes, and the question itself as the assistant's words. Every byte below is
 * a function of `seeded_pending`, so two runs of a case derive the same prefix,
 * and nothing here invents a fact the dataset does not already assert.
 *
 * The candidate TITLE stands in for the user's own words, which the dataset
 * does not have. That is the one substitution, and it is stated rather than
 * hidden: an ambiguous ask is by definition one that matched several works, and
 * the first offered title is the only term the exported case names.
 */
import type { SeedTrajectoryPrefixRequest, SeededCandidate } from "@animichi/contract/staging-prefix-contract";

import type { ExportedAgentInput } from "./dataset-roundtrip.ts";

/** Which tool raises which clarification (`workers/edge/src/agent/tools/`):
 * `resolve_anime` cannot tell two works apart, `search_nearby` two places. */
const ASKING_TOOL = {
  anime_ambiguity: "resolve_anime",
  place_ambiguity: "search_nearby",
} as const;

type AskingReason = keyof typeof ASKING_TOOL;

function isAskingReason(value: unknown): value is AskingReason {
  return typeof value === "string" && value in ASKING_TOOL;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One offered choice, kept with every member the seed declared: the ids AND
 * the coordinates a `place_ambiguity` pick is answered from. */
function candidateIn(value: unknown): SeededCandidate | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") return null;
  return value as unknown as SeededCandidate;
}

function candidatesIn(value: unknown): SeededCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const read = (value as readonly unknown[]).map(candidateIn);
  return read.length > 0 && read.every((one) => one !== null) ? read : null;
}

/** The state one case's previous turn left, once every member is readable. */
interface SeededPending {
  readonly reason: AskingReason;
  readonly revision: number;
  readonly candidates: SeededCandidate[];
}

/**
 * The case carries a `seeded_pending` this module cannot read whole.
 *
 * A THROW and not a `null`, and the distinction is the whole point of the
 * three-state read below. `null` means "this case starts from an empty
 * session", which is the truth for every case outside `phase1c_selection_v1`;
 * returning it for a MALFORMED seed would run a selection case with no
 * clarification open, and the turn would measure a `SELECTION_EXPIRED` refusal
 * and score it as the agent's answer. That silent degradation is exactly what
 * a starting point exists to remove, so an unreadable one has to be as loud as
 * a refused seeding is.
 */
export class UnreadableSeededPendingError extends Error {
  constructor(detail: string) {
    super(`the case's seeded_pending could not be read: ${detail}`);
    this.name = "UnreadableSeededPendingError";
  }
}

/** The clarification this seed names, refused when it names none this module
 * knows a tool for — a reason nothing can raise is not a reason. */
function askingReasonIn(held: Readonly<Record<string, unknown>>): AskingReason {
  if (isAskingReason(held.reason)) return held.reason;
  return raise(`reason ${JSON.stringify(held.reason)} names no asking tool`);
}

function raise(detail: string): never {
  throw new UnreadableSeededPendingError(detail);
}

/** The candidates it offered, whole or not at all: the ids a reply is
 * validated against are exactly what a trimmed list would silently change. */
function offeredCandidatesIn(held: Readonly<Record<string, unknown>>): SeededCandidate[] {
  return candidatesIn(held.candidates ?? held.ordered_candidates)
    ?? raise("its candidate list is empty or carries a row without an id and a title");
}

/** The revision a reply's `clarification_id` must equal. */
function revisionIn(held: Readonly<Record<string, unknown>>): number {
  const revision = held.revision;
  if (typeof revision === "number") return revision;
  return raise(`revision ${JSON.stringify(revision)} is not a number`);
}

/**
 * The state one case's previous turn left, in THREE answers rather than two.
 *
 * `null` is ABSENT — the key is missing or explicitly null, which is every case
 * outside `phase1c_selection_v1` and means "no prefix". An unreadable value
 * throws (see above). Absent is checked before the record check because the
 * exported JSON may omit the key entirely: `ExportedAgentInput` declares it
 * `| null`, but a missing key reads `undefined`, and a bare `held.reason` on it
 * would be a `TypeError` thrown from inside `setup()` — a failure that says
 * nothing about the case it failed.
 */
function seededPendingIn(inputs: ExportedAgentInput): SeededPending | null {
  const held: unknown = inputs.seeded_pending;
  if (held === null || held === undefined) return null;
  if (!isRecord(held)) return raise("it is not an object");
  return {
    reason: askingReasonIn(held),
    revision: revisionIn(held),
    candidates: offeredCandidatesIn(held),
  };
}

/** The arguments the asking tool ran with, in that tool's own parameter name. */
function askingParams(pending: SeededPending, subject: string): string {
  const named = pending.reason === "anime_ambiguity" ? { title: subject } : { location: subject };
  return JSON.stringify(named);
}

/** The offer the tool returned — the outcome shape `catalog-tool-outcomes.ts`
 * publishes, reduced to what the question is made of. */
function askingResult(pending: SeededPending): string {
  return JSON.stringify({
    outcome: pending.reason,
    clarification_reason: pending.reason,
    candidates: pending.candidates.map((candidate) => ({ id: candidate.id, title: candidate.title })),
  });
}

/** The question, in the assistant's own words: what could not be told apart. */
function askedQuestion(pending: SeededPending): string {
  return `Which one did you mean? ${pending.candidates.map((candidate) => candidate.title).join(" / ")}`;
}

/**
 * The prefix this case needs seeded, or null when it needs none.
 *
 * `caseId` is the idempotency key the edge dedupes on, and it is the DATASET's
 * own case name so that a re-run of one case is recognisably the same seeding
 * rather than a new one.
 */
export function trajectoryPrefixOf(
  inputs: ExportedAgentInput, caseId: string,
): SeedTrajectoryPrefixRequest | null {
  const pending = seededPendingIn(inputs);
  if (pending === null) return null;
  const subject = pending.candidates[0]?.title ?? "";
  return {
    case_id: caseId,
    user_text: subject,
    tool_call: {
      tool_name: ASKING_TOOL[pending.reason],
      params: askingParams(pending, subject),
      result_text: askingResult(pending),
    },
    assistant_text: askedQuestion(pending),
    pending_clarification: {
      id: pending.revision,
      reason: pending.reason,
      candidates: pending.candidates,
    },
    current_anime: null,
  };
}
