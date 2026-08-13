/**
 * OpenAPI change vocabulary (issue #1005 AC4).
 *
 * The typed change kinds and their severity table are the semantic core every
 * classifier layer shares: the recursive wire differ (`openapi-schema-diff.ts`)
 * and the operation-set classifier (`openapi-diff.ts`) both emit `ApiChange`
 * values through `change`, which derives the breaking/additive severity from
 * the one authoritative `BREAKING_KIND` table.
 */

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
}

const BREAKING_KIND: ReadonlySet<ApiChangeKind> = new Set<ApiChangeKind>([
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

export function change(kind: ApiChangeKind, message: string): ApiChange {
  return { kind, breaking: BREAKING_KIND.has(kind), message };
}
