/**
 * OpenAPI change vocabulary (issue #1005 AC4, #1596).
 *
 * The typed change kinds and their severity table are the semantic core every
 * classifier layer shares: the recursive wire differ (`openapi-schema-diff.ts`)
 * and the operation-set classifier (`openapi-diff.ts`) both emit `ApiChange`
 * values through `change`, which derives the breaking/additive severity from
 * the one authoritative `BREAKING_KINDS` table. Every change also carries the
 * `operation` it was classified under, so a change has an identity the approval
 * record can name — not just prose a human reads.
 *
 * That identity, and the record checked against it, belong to
 * `openapi-approvals.ts`: an intentional breaking change is approved only when
 * an entry names its document, method, path and kind exactly.
 */

import type { ApiOperation } from "./operation-set.js";

export type ApiChangeKind =
  | "endpoint-added"
  | "endpoint-removed"
  | "method-added"
  | "method-removed"
  | "schema-property-added"
  | "schema-property-removed"
  | "schema-property-type-changed"
  | "schema-property-required"
  | "schema-property-optional"
  | "enum-member-added"
  | "enum-member-removed"
  | "enum-constraint-added"
  | "enum-constraint-removed"
  | "request-schema-added"
  | "request-schema-removed"
  | "response-schema-added"
  | "response-schema-removed"
  | "request-body-required"
  | "request-body-optional"
  | "error-response-added"
  | "error-response-removed"
  | "error-status-changed";

/** One classified change with its compatibility severity. */
export interface ApiChange {
  readonly kind: ApiChangeKind;
  readonly breaking: boolean;
  readonly message: string;
  /** The operation the change was classified under. */
  readonly operation: ApiOperation;
}

/** Every breaking kind — the one severity table, in declaration order. */
export const BREAKING_KINDS: readonly ApiChangeKind[] = [
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
];

const BREAKING_KIND: ReadonlySet<ApiChangeKind> = new Set(BREAKING_KINDS);

/** Where a classifier records what it finds: the operation under
 * classification, and the sink its changes land in. */
export interface ChangeSink {
  readonly operation: ApiOperation;
  readonly out: ApiChange[];
}

export function change(kind: ApiChangeKind, message: string, operation: ApiOperation): ApiChange {
  return { kind, breaking: BREAKING_KIND.has(kind), message, operation };
}
