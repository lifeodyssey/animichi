/**
 * OpenAPI compatibility gate decision (issue #1005 AC5).
 *
 * `vetOpenApiDiff` turns the classification in `openapi-diff.ts` into a
 * decision:
 *  - breaking changes fail unless the approval flag is set;
 *  - additive changes pass;
 *  - introducing a future major path (e.g. `/v2/…` superseding `/v1/…`)
 *    requires the superseded operation to carry explicit `deprecated: true`
 *    plus an `x-sunset` date.
 */

import {
  operationKey,
  sortOperations,
  operationsFromOpenApi,
  type ApiDocument,
  type ApiOperation,
  type WireOperation,
} from "./operation-set.js";
import type { ApiChange } from "./openapi-changes.js";
import {
  operationViews,
  diffOpenApi,
  type OpenApiDiff,
  type ViewPair,
} from "./openapi-diff.js";

/** Vendor extension carrying the ISO sunset date on a deprecated operation. */
export const SUNSET_EXTENSION = "x-sunset";

/** Gate options: `allowBreaking` is the explicit approval signal. */
export interface VetOptions {
  readonly allowBreaking: boolean;
}

/** The gate decision: approved only when no rule is violated. */
export interface VetResult {
  readonly approved: boolean;
  readonly breaking: readonly ApiChange[];
  readonly additive: readonly ApiChange[];
  readonly violations: readonly string[];
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

function vetViolations(diff: OpenApiDiff, baseline: ApiDocument, candidate: ApiDocument, options: VetOptions): string[] {
  const violations: string[] = [];
  if (diff.breaking.length > 0 && !options.allowBreaking) {
    violations.push(...diff.breaking.map((item) => item.message));
  }
  violations.push(...futureMajorViolations(baseline, candidate));
  return violations;
}

/** Gate: breaking changes fail unless approved; additive changes pass; a
 * future major path must carry explicit deprecation/sunset metadata. */
export function vetOpenApiDiff(baseline: ApiDocument, candidate: ApiDocument, options: VetOptions): VetResult {
  const diff = diffOpenApi(baseline, candidate);
  const violations = vetViolations(diff, baseline, candidate, options);
  return {
    approved: violations.length === 0,
    breaking: diff.breaking,
    additive: diff.additive,
    violations,
  };
}
