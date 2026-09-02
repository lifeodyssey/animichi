// W0-S4 spike (#1247): the request vocabulary of the deliberately-long turn.
//
// The spec's S4 hard condition wants a turn that takes five minutes inside the
// alarm handler, which needs a whole-turn deadline larger than the production
// one. That deadline is therefore a REQUIRED request field with a spike-only
// floor — there is no default here on purpose, so nothing in this file can ever
// become the production budget. Production stays at the 100s of spec §二.
//
// Pure: no bindings, no database, no clock.

/** Spike-only floor from spec §四 S4 ("≥ 6 minutes"). Never a production default. */
export const SPIKE_MIN_DEADLINE_MS = 6 * 60_000;
/** A Durable Object alarm handler owns 15 minutes of wall time (spec §二). */
export const ALARM_WALL_CLOCK_LIMIT_MS = 15 * 60_000;
export const MAX_HOLD_MS = 5 * 60_000;
export const DEFAULT_TOOL_CALLS = 3;
export const MAX_TOOL_CALLS = 5;
export const DEFAULT_TITLE = "Hyouka";

interface Range {
  min: number;
  max: number;
}

const DEADLINE_RANGE: Range = { min: SPIKE_MIN_DEADLINE_MS, max: ALARM_WALL_CLOCK_LIMIT_MS };
const HOLD_RANGE: Range = { min: 0, max: MAX_HOLD_MS };
const TOOL_CALL_RANGE: Range = { min: 1, max: MAX_TOOL_CALLS };

export interface LongTurnCommand {
  /** Whole-turn budget written to `runs.deadline_at`. */
  deadlineMs: number;
  /** How long each tool step holds, which is how the turn is made to last minutes. */
  holdMs: number;
  toolCalls: number;
  title: string;
  /** Fault injection: crash after the tool returned, before its row is written. */
  crashBeforePersistStep: number | null;
  /** Fault injection: the tool itself fails, which must end the run `failed`. */
  failAtStep: number | null;
}

export type ParsedLongTurnCommand =
  | { ok: true; command: LongTurnCommand }
  | { ok: false; error: string };

function asRecord(body: unknown): Record<string, unknown> | null {
  const isObject = typeof body === "object" && body !== null && !Array.isArray(body);
  return isObject ? (body as Record<string, unknown>) : null;
}

function rangeError(key: string, range: Range): string {
  return `${key} must be ${String(range.min)}..${String(range.max)}`;
}

function rangedInteger(
  record: Record<string, unknown>,
  key: string,
  range: Range,
  fallback: number | null,
  errors: string[],
): number {
  const value = record[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.push(`${key} must be an integer`);
    return range.min;
  }
  if (value < range.min || value > range.max) errors.push(rangeError(key, range));
  return value;
}

function optionalStepIndex(
  record: Record<string, unknown>,
  key: string,
  toolCalls: number,
  errors: string[],
): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= toolCalls) {
    errors.push(`${key} must be a step index in 0..${String(toolCalls - 1)}`);
    return null;
  }
  return value;
}

function textOr(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** The holds are the turn's length, so they have to fit the budget they run under. */
function checkHoldsFitDeadline(command: LongTurnCommand, errors: string[]): void {
  if (command.holdMs * command.toolCalls >= command.deadlineMs) {
    errors.push("holdMs * toolCalls must be below deadlineMs");
  }
}

function buildCommand(record: Record<string, unknown>, errors: string[]): LongTurnCommand {
  const toolCalls = rangedInteger(record, "toolCalls", TOOL_CALL_RANGE, DEFAULT_TOOL_CALLS, errors);
  const command: LongTurnCommand = {
    deadlineMs: rangedInteger(record, "deadlineMs", DEADLINE_RANGE, null, errors),
    holdMs: rangedInteger(record, "holdMs", HOLD_RANGE, null, errors),
    toolCalls,
    title: textOr(record, "title", DEFAULT_TITLE),
    crashBeforePersistStep: optionalStepIndex(record, "crashBeforePersistStep", toolCalls, errors),
    failAtStep: optionalStepIndex(record, "failAtStep", toolCalls, errors),
  };
  checkHoldsFitDeadline(command, errors);
  return command;
}

export function parseLongTurnCommand(body: unknown): ParsedLongTurnCommand {
  const record = asRecord(body);
  if (record === null) return { ok: false, error: "body must be a JSON object" };
  const errors: string[] = [];
  const command = buildCommand(record, errors);
  return errors.length === 0 ? { ok: true, command } : { ok: false, error: errors.join("; ") };
}
