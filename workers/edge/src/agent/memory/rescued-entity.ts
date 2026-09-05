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
 * anime title the user typed and the place name they asked about. A return
 * short enough to be carried in full loses nothing, so it rescues nothing.
 *
 * A REPLAYED STEP RESCUES AGAIN, on purpose. `TurnSteps` answers a settled step
 * from `run_steps.result` without executing it, and an attempt that crashed
 * before its envelope was promoted would otherwise leave the ledger without an
 * entity the first attempt had already recorded. The ledger's dedup is what
 * makes doing it once per attempt indistinguishable from doing it once.
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
