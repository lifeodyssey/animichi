/**
 * Shared builders for the OpenAPI classifier tests (issue #1005 AC4).
 *
 * `op` / `doc` / `body` construct the minimal baseline and candidate documents
 * the classification cases diff; `breakingKinds` flattens a diff to its
 * breaking kinds. The severity table is asserted once per split test file so a
 * classification regression fails loudly.
 */

import type { ApiDocument, WireOperation, WireSchema } from "../src/operation-set.js";
import type { diffOpenApi } from "../src/openapi-diff.js";

const SUCCESS = { "200": { description: "OK" } } as const;

export function op(schema?: WireSchema, overrides: Partial<WireOperation> = {}): WireOperation {
  return {
    responses:
      schema === undefined ? SUCCESS : { "200": { description: "OK", content: { "application/json": { schema } } } },
    ...overrides,
  };
}

export function doc(paths: Record<string, Record<string, WireOperation>>): ApiDocument {
  return { paths };
}

export function body(required: boolean, schema: WireSchema): WireOperation["requestBody"] {
  return { required, content: { "application/json": { schema } } };
}

export const BREAKING_KINDS = new Set([
  "endpoint-removed",
  "method-removed",
  "schema-property-removed",
  "schema-property-type-changed",
  "schema-property-required",
  "enum-member-removed",
  "enum-constraint-added",
  "request-schema-removed",
  "response-schema-removed",
  "request-body-required",
  "error-response-removed",
  "error-status-changed",
]);

export function breakingKinds(diff: ReturnType<typeof diffOpenApi>): string[] {
  return diff.breaking.map((change) => change.kind);
}
