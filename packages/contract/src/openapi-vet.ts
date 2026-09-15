/**
 * OpenAPI compatibility gate decision (issue #1005 AC5).
 *
 * `vetOpenApiDiff` turns the classification in `openapi-diff.ts` into a
 * decision:
 *  - breaking changes fail unless the committed approval record names them
 *    exactly and their removal is realised in the candidate document (an
 *    `endpoint-removed` path answering no method, a `method-removed` method+path
 *    absent), or a human waived the run with the manual flag;
 *  - additive changes pass;
 *  - introducing a future major path (e.g. `/v2/…` superseding `/v1/…`)
 *    requires the superseded operation to carry explicit `deprecated: true`
 *    plus an `x-sunset` date.
 */

import {
  operationKey,
  operationsFromOpenApi,
  sortOperations,
  type ApiDocument,
  type ApiOperation,
  type WireOperation,
} from "./operation-set.js";
import {
  evaluateApprovals,
  unrealisedApprovalMessage,
  type ApprovalOutcome,
  type ApprovalRecord,
  type RecordedApproval,
} from "./openapi-approvals.js";
import type { ApiChange } from "./openapi-changes.js";
import {
  operationViews,
  diffOpenApi,
  type OpenApiDiff,
  type ViewPair,
} from "./openapi-diff.js";

/** Vendor extension carrying the ISO sunset date on a deprecated operation. */
export const SUNSET_EXTENSION = "x-sunset";

/** Gate options: `allowBreaking` is the explicit manual approval signal;
 * `record` is the committed record the gate reads, scoped to the document
 * being vetted. A run with neither approves no breaking change at all. */
export interface VetOptions {
  readonly allowBreaking: boolean;
  readonly record?: ApprovalRecord;
}

/** The gate decision: approved only when no rule is violated. */
export interface VetResult {
  readonly approved: boolean;
  readonly breaking: readonly ApiChange[];
  readonly additive: readonly ApiChange[];
  readonly violations: readonly string[];
  /** The breaking changes this run's approval record accounted for. */
  readonly recorded: readonly RecordedApproval[];
}

/** Extract the leading `/v<N>/` segment of a path, or null when unversioned. */
function majorVersionOf(path: string): number | null {
  const match = /^\/v(\d+)\//.exec(path);
  return match === null ? null : Number(match[1]);
}

/** Swap a path's major segment from `fromMajor` to `toMajor`. */
function withMajor(path: string, fromMajor: number, toMajor: number): string {
  return path.replace(`/v${String(fromMajor)}/`, `/v${String(toMajor)}/`);
}

function highestBaselineMajor(baseline: ApiDocument): number {
  const majors = operationsFromOpenApi(baseline)
    .map((operation) => majorVersionOf(operation.path))
    .filter((value): value is number => value !== null);
  return majors.length === 0 ? 1 : Math.max(...majors);
}

/** The superseded `/v1/…` operation a future-major addition must deprecate. */
function supersededMajorOperation(
  operation: ApiOperation,
  baseline: ApiDocument,
): ApiOperation | undefined {
  const major = majorVersionOf(operation.path);
  if (major === null) return undefined;
  const highestBaseline = highestBaselineMajor(baseline);
  if (major <= highestBaseline) return undefined;
  return { method: operation.method, path: withMajor(operation.path, major, highestBaseline) };
}

function isDeprecatedWithSunset(operation: WireOperation): boolean {
  return operation.deprecated === true && typeof operation[SUNSET_EXTENSION] === "string";
}

function undeprecatedMajorMessage(operation: ApiOperation, supersededKey: string): string {
  return (
    `${operationKey(operation)} introduces a future major path; ${supersededKey} must be ` +
    `deprecated: true with an ${SUNSET_EXTENSION} date`
  );
}

function majorViolation(views: ViewPair, operation: ApiOperation, superseded: ApiOperation): readonly string[] {
  const supersededKey = operationKey(superseded);
  if (!views.baseline.has(supersededKey)) return [];
  const candidateSuperseded = views.candidate.get(supersededKey);
  if (candidateSuperseded === undefined) return [];
  if (isDeprecatedWithSunset(candidateSuperseded)) return [];
  return [undeprecatedMajorMessage(operation, supersededKey)];
}

function pushFutureMajorViolation(violations: string[], views: ViewPair, operation: ApiOperation, baseline: ApiDocument): void {
  if (views.baseline.has(operationKey(operation))) return;
  const superseded = supersededMajorOperation(operation, baseline);
  if (superseded === undefined) return;
  violations.push(...majorViolation(views, operation, superseded));
}

function futureMajorViolations(baseline: ApiDocument, candidate: ApiDocument): readonly string[] {
  const violations: string[] = [];
  const views: ViewPair = { baseline: operationViews(baseline), candidate: operationViews(candidate) };
  for (const operation of sortOperations(operationsFromOpenApi(candidate))) {
    pushFutureMajorViolation(violations, views, operation, baseline);
  }
  return violations;
}

/** The manual flag waives breaking enforcement: nothing is checked, nothing is
 * approved. */
function waivedOutcome(): ApprovalOutcome {
  return { recorded: [], unrecorded: [], unrealised: [] };
}

/** No record to read: every breaking change stands unapproved. */
function unrecordedOutcome(changes: readonly ApiChange[]): ApprovalOutcome {
  return { recorded: [], unrecorded: changes, unrealised: [] };
}

/** The record's verdict for this run. The manual flag waives breaking
 * enforcement outright and never consults the record; without either, every
 * breaking change is a violation. */
function approvalsForRun(
  changes: readonly ApiChange[], options: VetOptions, candidate: ApiDocument,
): ApprovalOutcome {
  if (options.allowBreaking) return waivedOutcome();
  if (options.record === undefined) return unrecordedOutcome(changes);
  return evaluateApprovals(options.record, changes, operationsFromOpenApi(candidate));
}

function breakingViolations(outcome: ApprovalOutcome): readonly string[] {
  return [
    ...outcome.unrecorded.map((item) => item.message),
    ...outcome.unrealised.map(unrealisedApprovalMessage),
  ];
}

/** Every rule this run violated: the breaking changes no record accounted for,
 * then the future-major deprecation rules. */
function gateViolations(
  approvals: ApprovalOutcome, baseline: ApiDocument, candidate: ApiDocument,
): readonly string[] {
  return [...breakingViolations(approvals), ...futureMajorViolations(baseline, candidate)];
}

/** The gate's verdict, with the diff it classified and the approvals it used. */
function vetResult(diff: OpenApiDiff, approvals: ApprovalOutcome, violations: readonly string[]): VetResult {
  return {
    approved: violations.length === 0,
    breaking: diff.breaking,
    additive: diff.additive,
    violations,
    recorded: approvals.recorded,
  };
}

/** Gate: breaking changes fail unless the record names them and their removal
 * is realised in the candidate document (or a human passed the manual flag);
 * additive changes pass; a future major path must carry explicit
 * deprecation/sunset metadata. */
export function vetOpenApiDiff(
  baseline: ApiDocument, candidate: ApiDocument, options: VetOptions,
): VetResult {
  const diff = diffOpenApi(baseline, candidate);
  const approvals = approvalsForRun(diff.breaking, options, candidate);
  return vetResult(diff, approvals, gateViolations(approvals, baseline, candidate));
}
