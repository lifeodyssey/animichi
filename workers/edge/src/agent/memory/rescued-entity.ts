/**
 * The literal entity a tool call carried, rescued into the retained-entity
 * ledger at the moment that call's return is frozen (card #1378, spec §九
 * 9.2 (5)) — port of `apps/agent`'s `_retain_entity`.
 *
 * WHY IT LIVES ON THE WRITE PATH NOW. The rescue used to happen inside the
 * per-request compaction pass, which saw the same old call again on every model
 * request of every later turn. The summary is decided once now, where the step
 * is written (`session/frozen-tool-return.ts`), and the words that summary is
 * about to drop are rescued in that same step.
 *
 * WHAT IS WORTH RESCUING is what a summary shape makes no promise to keep: the
 * anime title the user typed and the place name they asked about.
 *
 * `plan_route` DOES NOT JOIN THEM, and #1389 is where that was decided rather
 * than left unasked. The tool takes two arguments and neither is a literal the
 * user typed. `search_result_ref` is a handle this tier minted moments earlier
 * and deliberately does not outlive its run (`session/minted-refs.ts`), so
 * retaining it would spend one of eight slots on a string that reads
 * `stale_ref` everywhere it could be named. `pacing` is a three-value enum,
 * already witnessed as the session's hard constraint by
 * `turn-fact-recorder.ts` and already rendered in the `<agent_status>` bar —
 * rescuing it would put the same fact in the prompt twice, which is the exact
 * duplication `rescueCallEntity` skips a resolved title for below. The route's
 * own anime reached the session through `resolve_anime`, whose title IS
 * rescued here. What a frozen route return would otherwise lose is its ordered
 * stop ids, and those are kept in the summary itself
 * (`session/tool-return-summary.ts`) rather than pushed into a bounded ledger
 * that would evict them: a route's ids are one value per stop, and the ledger
 * holds one value per tool.
 *
 * A SHORT RETURN RESCUES NOTHING, and the reason is #1377 rather than anything
 * about the return itself — the entity lives in the CALL's arguments, not in
 * the answer. Since every turn's assistant tool-call message is replayed
 * verbatim (`turn-transcript.ts`), those arguments are still in the model's
 * context in full; a call whose return was never shrunk has therefore lost
 * nothing worth rescuing, and retaining it would spend the ledger's eight slots
 * on entities the transcript already carries. Only the calls whose answer was
 * replaced are the ones a later turn may have trouble anchoring.
 *
 * A RETRY RESCUES AGAIN, on purpose, and from the ROWS rather than from a
 * second execution: the envelope carrying this ledger is promoted only when a
 * run reaches a terminal path, so an attempt that settled a step and crashed
 * left the row behind and the ledger nowhere. `TurnAttempt.drive` walks this
 * run's settled steps back through here before the loop resumes
 * (`session/turn-attempt.ts`), and the ledger's dedup is what makes doing that
 * every attempt indistinguishable from doing it once.
 */
import { isJsonRecord } from "../json-record.ts";
import type { TurnMemory } from "./session-memory.ts";

/**
 * The tool arguments that carry a literal, user-supplied entity worth rescuing
 * verbatim — an anime title and a place name, keyed by the argument's own name.
 */
const ENTITY_ARGUMENT: Readonly<Record<string, string>> = {
  resolve_anime: "title",
  search_nearby: "location",
};

/** The literal entity this call carried, if its tool has one at all. */
function entityIn(toolName: string, input: unknown): string | null {
  const field = ENTITY_ARGUMENT[toolName];
  if (field === undefined || !isJsonRecord(input)) return null;
  const value = input[field];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Rescue this call's entity, if it has one worth rescuing.
 *
 * A value that already equals the session's resolved title is skipped: it is
 * carried unabridged by `currentAnime` and by the candidate summary while it is
 * still ambiguous, so retaining it here would spend the same prompt budget
 * twice.
 */
export function rescueCallEntity(turn: TurnMemory, toolName: string, input: unknown): void {
  const value = entityIn(toolName, input);
  if (value === null || value === turn.resolvedTitle) return;
  const { memory } = turn;
  turn.remember({ ...memory, retainedEntities: memory.retainedEntities.record(toolName, value) });
}
