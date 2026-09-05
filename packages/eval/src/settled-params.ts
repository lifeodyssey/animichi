/**
 * The params each of a turn's calls RAN with, off the transcript read (E-2
 * #1381, spec §十 10.2, owner decision #1311).
 *
 * The stream and the read are two authors describing one call, and neither
 * record names the other: the frames carry a `toolCallId` the read never sees,
 * and the read carries a `(run_id, step_index)` the frames never carry. So the
 * pairing has to be derived, and it is derived the way the metric that consumes
 * it already pairs: `ArgumentCorrectness(tool, occurrence=k)` selects the k-th
 * call to a tool, so the k-th call to a tool on the stream is answered by the
 * k-th step that run settled under that name.
 *
 * Its own module rather than part of `turn-transcript.ts` because it is the one
 * part of the shaper that reads the RETRIEVAL surface — everything else there
 * reads frames — and because a mistake here is a wrong score rather than a
 * missing one.
 */
import type { GetSessionHistoryResponse } from "@animichi/contract/session-history-contract";

import { objectOrNull } from "./json-object.ts";
import type { TranscriptStep } from "./turn-transcript.ts";

/**
 * Whether the read published a step record AT ALL.
 *
 * `false` is not "no params for these calls" — it is "no witness was offered":
 * a page from an edge older than this field, a `null` from the Python route, a
 * read that never answered (`staging-turn-task.ts` hands `null` on a non-ok
 * response). `ArgumentCorrectness` emits NO metric then, because a turn nobody
 * published a second record for is unmeasured rather than wrong. It is the
 * page-level form of Python's per-step `StepRecord.params_recorded` (#443) —
 * the wire cannot say it per call, and a page either carries the array or does
 * not.
 */
export function paramsRecordedIn(history: GetSessionHistoryResponse | null): boolean {
  return (history?.steps ?? null) !== null;
}

/** One settled step of one run, as the transcript read publishes it. */
export type PublishedStep = NonNullable<NonNullable<GetSessionHistoryResponse["steps"]>>[number];

/**
 * The steps the MEASURED run settled, in the order it settled them.
 *
 * The read carries every run of the session — a case with recorded history is
 * several turns on one session — while the frames are one turn's. Pairing a
 * call with another run's step would compare two different calls, so the run
 * the page names as its latest is the only one read here.
 */
export function settledSteps(history: GetSessionHistoryResponse | null): readonly PublishedStep[] {
  const runId = history?.run?.run_id;
  const steps = history?.steps ?? [];
  const measured = steps.filter((step) => step.run_id === runId);
  return runId === undefined ? [] : [...measured].sort((left, right) => left.step_index - right.step_index);
}

/** The params one published step carries, or null when its text is not a JSON
 * object — Python's two parse refusals, which score 0 there and are "no second
 * witness" here. */
function parsedParams(text: string): Readonly<Record<string, unknown>> | null {
  try {
    return objectOrNull(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Each tool's settled params, oldest first — the queue the pairing draws on. */
function paramsByTool(published: readonly PublishedStep[]): Map<string, string[]> {
  const queued = new Map<string, string[]>();
  for (const step of published) {
    const held = queued.get(step.tool_name) ?? [];
    queued.set(step.tool_name, [...held, step.params]);
  }
  return queued;
}

/** The next unclaimed step of that tool, consumed so the following call to the
 * same tool takes the one after it. */
function nextParamsOf(queued: Map<string, string[]>, toolName: string): Readonly<Record<string, unknown>> | null {
  const text = queued.get(toolName)?.shift();
  return text === undefined ? null : parsedParams(text);
}

/**
 * The calls, each carrying the params published for it.
 *
 * Paired by tool name and occurrence, which is the pairing
 * `ArgumentCorrectness(tool, occurrence=k)` makes itself: the k-th call to a
 * tool on the stream is answered by the k-th step that run settled under that
 * name. Positional pairing would drift on the first settled step the stream
 * does not publish — `respond` is one on every answered turn.
 */
export function withSettledParams(
  calls: readonly TranscriptStep[],
  published: readonly PublishedStep[],
): readonly TranscriptStep[] {
  const queued = paramsByTool(published);
  return calls.map((call) => ({ ...call, params: nextParamsOf(queued, call.toolName) }));
}
