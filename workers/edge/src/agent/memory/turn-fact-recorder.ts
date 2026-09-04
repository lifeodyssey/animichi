/**
 * What one turn's settled steps put in the fact ledger (card #1290) — port of
 * `apps/agent`'s `domain/fact_ledger.py::record_turn_facts`, called where
 * Python called it: once, after the run, over the run's own steps
 * (`public_api._execution_result`, command-then-query).
 *
 * DERIVED FROM STEPS, NEVER FROM PROSE. A pacing the model merely mentioned is
 * not a hard constraint; a pacing it actually passed to `plan_route` is. That
 * is the whole reason there is no extraction round here and no model call: the
 * ledger's claim is "this is what the session did", which only a settled step
 * can witness.
 *
 * IDEMPOTENT UNDER REPLAY, which is what makes it safe on this tier. A retried
 * alarm replays every settled step (`TurnSteps` answers it from
 * `run_steps.result` without executing), so this recorder sees the same list
 * again — and both ledger writes are no-ops when nothing changed: restating the
 * live pacing returns the same ledger, and an unchanged selection returns the
 * same set.
 *
 * `plan_selected` IS PRODUCED BY `selection/` (#1288), which settles under that
 * tool name through the same `TurnSteps` — server-initiated rather than model-
 * issued, which is exactly why the recorder never had to learn about it.
 *
 * It does have to know the SHAPE, and the shape is not Python's. Python put
 * `build_itinerary_payload(itinerary)` on the step directly, so
 * `ordered_points` sat at the top of `details`; a selection step here settles a
 * `SelectionRecord` — whose whole job is to carry enough for the REPLAY to
 * rebuild the answer without re-calling the catalog — so the route it planned
 * is one level down, under `itinerary`. The tool name stays a literal rather
 * than an import: `memory/` is below `selection/` and must not depend upwards,
 * and the agreement is pinned end-to-end by
 * `test/selection-facts.test.ts` instead, which fails if either side renames.
 */
import { isJsonRecord } from "../json-record.ts";
import { PACINGS, type Pacing, type SceneEntry } from "./fact-ledger.ts";
import type { SessionMemory, TurnMemory } from "./session-memory.ts";

/** The tool name #1288's selection step settles under. */
const SELECTED_ROUTE_STEP = "plan_selected";

/** One settled step, reduced to the three things a fact can be read out of. */
export interface RecordedStep {
  readonly toolName: string;
  /** The arguments the call was made with. */
  readonly input: unknown;
  /** The outcome the tool answered with, as `run_steps.result.details`. */
  readonly details: unknown;
}

function fieldOf(value: unknown, field: string): unknown {
  return isJsonRecord(value) ? value[field] : undefined;
}

function pacingOf(step: RecordedStep): Pacing | null {
  return PACINGS.find((pacing) => pacing === fieldOf(step.input, "pacing")) ?? null;
}

/** A `plan_route` that answered anything but `ok` planned nothing, so the
 * pacing it was asked for is not a constraint the session applied. */
function isRoutedStep(step: RecordedStep): boolean {
  return step.toolName === "plan_route" && fieldOf(step.details, "status") === "ok";
}

/** One point's scene reference, or nothing when it names no episode. The
 * catalog's `-1` sentinel means "no episode", which is not a fact. */
function sceneEntry(point: unknown): SceneEntry | null {
  const pointId = fieldOf(point, "id");
  const episode = fieldOf(point, "episode");
  if (typeof pointId !== "string" || pointId === "") return null;
  if (typeof episode !== "number" || !Number.isInteger(episode) || episode < 0) return null;
  return { pointId, value: sceneValue(point, episode) };
}

function sceneValue(point: unknown, episode: number): string {
  const name = fieldOf(point, "name");
  const seconds = fieldOf(point, "time_seconds");
  const named = typeof name === "string" && name !== "" ? name : "unnamed scene";
  const at = typeof seconds === "number" && seconds >= 0 ? ` @ ${String(seconds)}s` : "";
  return `Episode ${String(episode)} — ${named}${at}`;
}

function selectedScenes(step: RecordedStep): SceneEntry[] | null {
  if (step.toolName !== SELECTED_ROUTE_STEP) return null;
  const points = fieldOf(fieldOf(step.details, "itinerary"), "ordered_points");
  if (!Array.isArray(points)) return null;
  return points.flatMap((point) => sceneEntry(point) ?? []);
}

/** The ledger this one step leaves behind. */
function afterStep(memory: SessionMemory, step: RecordedStep, now: Date): SessionMemory {
  const pacing = isRoutedStep(step) ? pacingOf(step) : null;
  if (pacing !== null) return { ...memory, facts: memory.facts.appendHardConstraint(pacing, now) };
  const scenes = selectedScenes(step);
  if (scenes === null) return memory;
  return { ...memory, facts: memory.facts.replaceSceneReferences(scenes, now) };
}

/** Record every fact this turn's steps witnessed, in the order they settled. */
export function recordTurnFacts(
  turn: TurnMemory, steps: readonly RecordedStep[], now: Date,
): void {
  turn.remember(steps.reduce((memory, step) => afterStep(memory, step, now), turn.memory));
}
