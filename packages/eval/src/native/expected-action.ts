/**
 * The declared next action of an evaluated suffix (#1558).
 *
 * `expected_next_action` describes what must happen first after a frozen
 * prefix, as constraints rather than literals: a tool name (or `none`), and
 * bounded checks on the work id, radius or geographic box the action uses. The
 * witnesses are native: `after_tool` observations for a model call, and the
 * committed domain entry for deterministic work the server performs without a
 * model call.
 */
import type { Entry } from '@earendil-works/pi-agent-core';
import { readSelectionEntry } from '@animichi/agent/selection';
import { Evaluator, type EvaluatorContext } from 'logfire/evals';
import { objectOrNull } from '../json-object.ts';
import {
  NO_MODEL_TOOL, ExpectedNextAction as ExpectedNextActionSchema,
  type ArgumentConstraint, type ExpectedNextAction,
} from './prefix-corpus.ts';
import type { NativeCaseMetadata, NativeOutput } from './evaluation-types.ts';

/** One model-initiated tool call, observed through the native `after_tool` witness. */
export interface ToolObservation {
  readonly toolName: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly isError: boolean;
}

/** What the evaluated suffix actually did first. */
export type ActionSubject =
  | { readonly kind: 'model_call'; readonly tool: string; readonly arguments: Readonly<Record<string, unknown>> }
  | { readonly kind: 'domain_entry'; readonly entryType: string; readonly request: Readonly<Record<string, unknown>> };

type ModelCallSubject = Extract<ActionSubject, { kind: 'model_call' }>;
type DomainEntrySubject = Extract<ActionSubject, { kind: 'domain_entry' }>;

/** Read the native `after_tool` witness an attempt recorded; absent means no model call. */
export function modelCallsFrom(attributes: Readonly<Record<string, unknown>>): readonly ToolObservation[] {
  const recorded = attributes['pi.after_tool'];
  if (recorded === undefined) return [];
  if (!Array.isArray(recorded)) throw new TypeError('pi.after_tool must be the recorded after_tool witness array');
  return recorded.map(observation);
}

function observation(entry: unknown): ToolObservation {
  const record = objectOrNull(entry);
  const name = record?.toolName;
  if (record === null || typeof name !== 'string' || name === '') throw new TypeError('pi.after_tool entry must carry a toolName');
  return { toolName: name, arguments: objectOrNull(record.args) ?? {}, isError: record.isError === true };
}

/** Read the committed domain entries a suffix appended; only custom entries name one. */
export function domainEntriesFrom(entries: readonly Entry[]): readonly ActionSubject[] {
  return entries.flatMap((entry) => entry.type === 'custom'
    ? [{ kind: 'domain_entry' as const, entryType: entry.customType, request: requestOf(entry) }] : []);
}

function requestOf(entry: Entry): Readonly<Record<string, unknown>> {
  if (entry.type !== 'custom') return {};
  const selection = readSelectionEntry(entry);
  return selection === undefined ? objectOrNull(entry.data) ?? {} : selection.result.request;
}

/** Every violation of the declared action; empty means it matched. */
export function actionViolations(expected: ExpectedNextAction, subjects: readonly ActionSubject[]): readonly string[] {
  const calls = subjects.filter((subject): subject is ModelCallSubject => subject.kind === 'model_call');
  if (expected.tool === NO_MODEL_TOOL) return deterministicViolations(expected, calls, subjects);
  const first = calls[0];
  if (first === undefined) return [`expected tool ${expected.tool} but the suffix made no model-initiated tool call`];
  return [...(first.tool === expected.tool ? [] : [`expected tool ${expected.tool} but the first model call was ${first.tool}`]),
    ...constraintViolations(expected.arguments, first.arguments), ...forbiddenViolations(expected, subjects)];
}

function deterministicViolations(
  expected: ExpectedNextAction, calls: readonly ModelCallSubject[], subjects: readonly ActionSubject[],
): readonly string[] {
  const violations = calls.map((call) => `tool "none" forbids model-initiated tool calls but ${call.tool} was called`);
  const entry = subjects.find((subject): subject is DomainEntrySubject =>
    subject.kind === 'domain_entry' && subject.entryType === expected.domain_entry);
  if (entry === undefined) violations.push(`tool "none" requires the native domain entry ${String(expected.domain_entry)}`);
  else violations.push(...constraintViolations(expected.arguments, entry.request));
  return [...violations, ...forbiddenViolations(expected, subjects)];
}

function forbiddenViolations(expected: ExpectedNextAction, subjects: readonly ActionSubject[]): readonly string[] {
  const forbidden = expected.forbidden;
  if (forbidden === undefined) return [];
  return subjects.filter((subject): subject is ModelCallSubject => subject.kind === 'model_call')
    .flatMap((subject) => callForbiddenViolations(forbidden, subject));
}

function callForbiddenViolations(forbidden: NonNullable<ExpectedNextAction['forbidden']>, subject: ModelCallSubject): readonly string[] {
  const violations = forbidden.tools.includes(subject.tool) ? [`forbidden tool ${subject.tool} was called`] : [];
  return [...violations, ...forbidden.arguments
    .filter((constraint) => constraintViolations([constraint], subject.arguments).length === 0)
    .map((constraint) => `forbidden ${describe(constraint)} was used`)];
}

function constraintViolations(constraints: readonly ArgumentConstraint[], args: Readonly<Record<string, unknown>>): readonly string[] {
  return constraints.flatMap((constraint) => constraintViolation(constraint, args[constraint.argument], args));
}

function constraintViolation(constraint: ArgumentConstraint, value: unknown, args: Readonly<Record<string, unknown>>): readonly string[] {
  switch (constraint.kind) {
    case 'enum': return constraint.values.some((allowed) => allowed === value) ? [] : [fail(constraint, args, `one of ${list(constraint.values)}`)];
    case 'set': return setViolation(constraint, value, args);
    case 'range': return rangeViolation(constraint, value, args);
    case 'bounds': return boundsViolation(constraint, value, args);
  }
}

function setViolation(constraint: Extract<ArgumentConstraint, { kind: 'set' }>, value: unknown, args: Readonly<Record<string, unknown>>): readonly string[] {
  if (!Array.isArray(value)) return [fail(constraint, args, 'an array')];
  const outside = value.filter((item) => !constraint.values.some((allowed) => allowed === item));
  const violations = outside.length === 0 ? [] : [fail(constraint, args, `members of ${list(constraint.values)}`)];
  if (constraint.max_items !== undefined && value.length > constraint.max_items) violations.push(fail(constraint, args, `at most ${String(constraint.max_items)} members`));
  return violations;
}

function rangeViolation(constraint: Extract<ArgumentConstraint, { kind: 'range' }>, value: unknown, args: Readonly<Record<string, unknown>>): readonly string[] {
  if (typeof value !== 'number') return [fail(constraint, args, 'a number')];
  if (constraint.min !== undefined && value < constraint.min) return [fail(constraint, args, `at least ${String(constraint.min)}`)];
  if (constraint.max !== undefined && value > constraint.max) return [fail(constraint, args, `at most ${String(constraint.max)}`)];
  return [];
}

function boundsViolation(constraint: Extract<ArgumentConstraint, { kind: 'bounds' }>, value: unknown, args: Readonly<Record<string, unknown>>): readonly string[] {
  const point = coordinateOf(value);
  if (point === undefined) return [fail(constraint, args, 'a lat/lng coordinate or "lat,lng" string')];
  const inside = point.lat >= constraint.min_lat && point.lat <= constraint.max_lat
    && point.lng >= constraint.min_lng && point.lng <= constraint.max_lng;
  return inside ? [] : [fail(constraint, args, `lat ${String(constraint.min_lat)}..${String(constraint.max_lat)}, lng ${String(constraint.min_lng)}..${String(constraint.max_lng)}`)];
}

function coordinateOf(value: unknown): { lat: number; lng: number } | undefined {
  if (typeof value === 'string') {
    const [lat, lng] = value.split(',');
    return lat !== undefined && lng !== undefined && finite(lat) && finite(lng) ? { lat: Number(lat), lng: Number(lng) } : undefined;
  }
  const record = objectOrNull(value);
  if (record === null) return undefined;
  const { lat, lng } = record;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : undefined;
}

function finite(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value));
}

function list(values: readonly (string | number)[]): string {
  return values.map((value) => JSON.stringify(value)).join(', ');
}

function describe(constraint: ArgumentConstraint): string {
  switch (constraint.kind) {
    case 'enum': return `enum(${constraint.argument}=one of ${list(constraint.values)})`;
    case 'set': return `set(${constraint.argument}⊂${list(constraint.values)})`;
    case 'range': return `range(${constraint.argument})`;
    case 'bounds': return `bounds(${constraint.argument})`;
  }
}

function fail(constraint: ArgumentConstraint, args: Readonly<Record<string, unknown>>, requirement: string): string {
  return `argument ${constraint.argument}=${JSON.stringify(args[constraint.argument] ?? null)} must be ${requirement}`;
}

/**
 * The named boolean assertion a native prefix dataset registers. The declared
 * action lives in the case metadata, so the input type stays the caller's.
 */
export class ExpectedActionPass<Inputs = unknown> extends Evaluator<Inputs, NativeOutput, NativeCaseMetadata> {
  static override evaluatorName = 'expected_next_action';

  override evaluate({ attributes, output, metadata }: EvaluatorContext<Inputs, NativeOutput, NativeCaseMetadata>): boolean {
    const declared = objectOrNull(metadata)?.expected_next_action;
    const expected = declared === undefined ? undefined : parseExpected(declared);
    if (expected === undefined) return false;
    const calls = modelCallsFrom(attributes).map((call) => ({ kind: 'model_call' as const, tool: call.toolName, arguments: call.arguments }));
    return actionViolations(expected, [...calls, ...domainEntriesFrom(output.transcript)]).length === 0;
  }
}

function parseExpected(value: unknown): ExpectedNextAction | undefined {
  // The corpus loader already parsed this metadata; re-parse to keep the evaluator total.
  const parsed = ExpectedNextActionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
