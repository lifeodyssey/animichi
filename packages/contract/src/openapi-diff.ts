/**
 * OpenAPI change classification (issue #1005 AC4).
 *
 * `diffOpenApi` classifies a baseline→candidate change into typed changes
 * across five semantic areas: endpoint (path/method), schema (properties and
 * request/response schema presence), requiredness (properties and the request
 * body's `required` flag), enum members, and error contract (response status
 * codes). The breaking/additive split is the go-live compatibility rule: after
 * go-live, `/v1` may only grow additively; removing or tightening an existing
 * surface is breaking.
 *
 * This module owns the operation-set orchestration plus the operation-level
 * wire differ (schema presence, request-body requiredness, error contract);
 * the recursive schema-node differ lives in `openapi-schema-diff.ts` and the
 * change vocabulary / vet decision in `openapi-changes.ts` / `openapi-vet.ts`.
 *
 * Every change is recorded through the `ChangeSink` of the operation it was
 * found under, so a change carries the operation identity an approval record
 * names (#1596) even when the classification happened inside a schema node.
 */

import {
  operationKey,
  sortOperations,
  operationsFromOpenApi,
  type ApiDocument,
  type ApiOperation,
  type WireOperation,
  type WireSchema,
} from "./operation-set.js";
import { change, type ApiChange, type ChangeSink } from "./openapi-changes.js";
import { diffSchema } from "./openapi-schema-diff.js";

/** The classification outcome split by severity. */
export interface OpenApiDiff {
  readonly breaking: readonly ApiChange[];
  readonly additive: readonly ApiChange[];
}

// Operation-level wire differ for one operation: schema presence,
// requiredness, and the error contract.

type Media = "request" | "response";

/** Baseline→candidate wire operation pair at one operation key. */
interface OperationPair {
  readonly baseline: WireOperation;
  readonly candidate: WireOperation;
}

/** Baseline→candidate schema pair at one structural position. */
interface SchemaPair {
  readonly baseline: WireSchema | undefined;
  readonly candidate: WireSchema | undefined;
}

/** Baseline→candidate error-status sets. */
interface SetPair {
  readonly baseline: ReadonlySet<string>;
  readonly candidate: ReadonlySet<string>;
}

/** Baseline→candidate wire-view maps (shared with the vet decision). */
export interface ViewPair {
  readonly baseline: Map<string, WireOperation>;
  readonly candidate: Map<string, WireOperation>;
}

function pushChange(sink: ChangeSink, kind: ApiChange["kind"], key: string, suffix: string): void {
  sink.out.push(change(kind, `${key} ${suffix}`, sink.operation));
}

function schemaOf(operation: WireOperation, media: Media): WireSchema | undefined {
  const content = media === "request" ? operation.requestBody?.content : operation.responses["200"]?.content;
  return content?.["application/json"]?.schema;
}

function isErrorStatus(status: string): boolean {
  if (status === "default") return true;
  const code = Number(status);
  return !Number.isNaN(code) && code >= 400;
}

function errorStatuses(operation: WireOperation): readonly string[] {
  return Object.keys(operation.responses).filter(isErrorStatus).sort();
}

function requestBodyOptionalized(
  baseline: WireOperation,
  candidate: WireOperation,
): boolean {
  if (baseline.requestBody === undefined || candidate.requestBody === undefined) {
    return false;
  }
  return baseline.requestBody.required === true && candidate.requestBody.required !== true;
}

function requirednessKind(pair: OperationPair): ApiChange["kind"] | null {
  if (pair.candidate.requestBody?.required === true && pair.baseline.requestBody?.required !== true) {
    return "request-body-required";
  }
  if (requestBodyOptionalized(pair.baseline, pair.candidate)) return "request-body-optional";
  return null;
}

function diffRequestRequiredness(pair: OperationPair, key: string, sink: ChangeSink): void {
  const kind = requirednessKind(pair);
  if (kind === null) return;
  const suffix = kind === "request-body-required" ? "request body became required" : "request body became optional";
  pushChange(sink, kind, key, suffix);
}

function diffSchemaPresence(pair: SchemaPair, at: string, media: Media, sink: ChangeSink): void {
  if (pair.baseline !== undefined && pair.candidate !== undefined) {
    diffSchema(pair.baseline, pair.candidate, at, sink);
  } else if (pair.candidate !== undefined) {
    pushChange(sink, `${media}-schema-added`, at, "schema was added");
  } else if (pair.baseline !== undefined) {
    pushChange(sink, `${media}-schema-removed`, at, "schema was removed");
  }
}

function diffEndpointSchema(pair: OperationPair, key: string, media: Media, sink: ChangeSink): void {
  const at = `${key}.${media}`;
  const schemas: SchemaPair = { baseline: schemaOf(pair.baseline, media), candidate: schemaOf(pair.candidate, media) };
  diffSchemaPresence(schemas, at, media, sink);
}

function diffOperationSchemas(pair: OperationPair, key: string, sink: ChangeSink): void {
  diffEndpointSchema(pair, key, "request", sink);
  diffRequestRequiredness(pair, key, sink);
  diffEndpointSchema(pair, key, "response", sink);
}

function difference(from: ReadonlySet<string>, without: ReadonlySet<string>): string[] {
  return [...from].filter((item) => !without.has(item));
}

function diffErrorStatusSet(statuses: SetPair, key: string, sink: ChangeSink): void {
  for (const status of difference(statuses.baseline, statuses.candidate)) {
    pushChange(sink, "error-response-removed", key, `lost ${status} error response`);
  }
  for (const status of difference(statuses.candidate, statuses.baseline)) {
    pushChange(sink, "error-response-added", key, `gained ${status} error response`);
  }
}

function flagRenumbering(statuses: SetPair, key: string, sink: ChangeSink): void {
  const removed = difference(statuses.baseline, statuses.candidate).length > 0;
  const added = difference(statuses.candidate, statuses.baseline).length > 0;
  if (removed && added) pushChange(sink, "error-status-changed", key, "renumbered its error responses");
}

function diffErrorContract(pair: OperationPair, key: string, sink: ChangeSink): void {
  const statuses: SetPair = {
    baseline: new Set(errorStatuses(pair.baseline)),
    candidate: new Set(errorStatuses(pair.candidate)),
  };
  diffErrorStatusSet(statuses, key, sink);
  flagRenumbering(statuses, key, sink);
}

// Operation-set orchestration: endpoint/method adds and removals, then the
// shared operations' wire differ.

function operationByKey(operations: readonly ApiOperation[]): Map<string, ApiOperation> {
  return new Map(operations.map((operation) => [operationKey(operation), operation]));
}

function pathSet(document: ApiDocument): Set<string> {
  return new Set(Object.keys(document.paths));
}

/** Map every operation key to its wire view, for metadata lookups. */
export function operationViews(document: ApiDocument): Map<string, WireOperation> {
  const views = new Map<string, WireOperation>();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      views.set(operationKey({ method: method.toUpperCase(), path }), operation);
    }
  }
  return views;
}

function pushRemovedOperation(
  baselineOp: ApiOperation,
  candidatePaths: Set<string>,
  out: ApiChange[],
): void {
  const kind = candidatePaths.has(baselineOp.path) ? "method-removed" : "endpoint-removed";
  out.push(change(kind, `${operationKey(baselineOp)} was removed`, baselineOp));
}

/** The operation maps, documents, and change sink shared by the orchestrators. */
interface OperationDiff {
  readonly baselineOps: Map<string, ApiOperation>;
  readonly candidateOps: Map<string, ApiOperation>;
  readonly baseline: ApiDocument;
  readonly candidate: ApiDocument;
  readonly out: ApiChange[];
}

function operationDiff(baseline: ApiDocument, candidate: ApiDocument): OperationDiff {
  return {
    baselineOps: operationByKey(sortOperations(operationsFromOpenApi(baseline))),
    candidateOps: operationByKey(sortOperations(operationsFromOpenApi(candidate))),
    baseline,
    candidate,
    out: [],
  };
}

function diffRemovedOperations(diff: OperationDiff): void {
  const candidatePaths = pathSet(diff.candidate);
  for (const [key, baselineOp] of diff.baselineOps) {
    if (diff.candidateOps.has(key)) continue;
    pushRemovedOperation(baselineOp, candidatePaths, diff.out);
  }
}

function operationPair(views: ViewPair, key: string): OperationPair | null {
  const baseline = views.baseline.get(key);
  const candidate = views.candidate.get(key);
  if (baseline === undefined || candidate === undefined) return null;
  return { baseline, candidate };
}

function diffSharedOperation(views: ViewPair, operation: ApiOperation, out: ApiChange[]): void {
  const key = operationKey(operation);
  const pair = operationPair(views, key);
  if (pair === null) return;
  const sink: ChangeSink = { operation, out };
  diffErrorContract(pair, key, sink);
  diffOperationSchemas(pair, key, sink);
}

function diffSharedOperations(diff: OperationDiff): void {
  const views: ViewPair = { baseline: operationViews(diff.baseline), candidate: operationViews(diff.candidate) };
  for (const [key, operation] of diff.baselineOps) {
    if (diff.candidateOps.has(key)) diffSharedOperation(views, operation, diff.out);
  }
}

function diffAddedOperations(diff: OperationDiff): void {
  const baselinePaths = pathSet(diff.baseline);
  for (const [key, candidateOp] of diff.candidateOps) {
    if (diff.baselineOps.has(key)) continue;
    const kind = baselinePaths.has(candidateOp.path) ? "method-added" : "endpoint-added";
    diff.out.push(change(kind, `${key} was added`, candidateOp));
  }
}

function splitChanges(out: ApiChange[]): OpenApiDiff {
  return {
    breaking: out.filter((item) => item.breaking),
    additive: out.filter((item) => !item.breaking),
  };
}

/** Classify a baseline→candidate OpenAPI change into breaking/additive parts. */
export function diffOpenApi(baseline: ApiDocument, candidate: ApiDocument): OpenApiDiff {
  const diff = operationDiff(baseline, candidate);
  diffRemovedOperations(diff);
  diffSharedOperations(diff);
  diffAddedOperations(diff);
  return splitChanges(diff.out);
}
