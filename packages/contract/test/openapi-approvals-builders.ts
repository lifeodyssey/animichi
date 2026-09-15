/**
 * Shared builders for the approval-record tests (#1596).
 *
 * The record's test files — its matching and realisation rules, the vet's use
 * of it, and the CLI run — judge the same canonical entry against the same
 * document shapes, so they construct those fixtures here, once:
 * `recordedRootRemoval` is the entry this card lands and the variant builder
 * every near-miss case uses, and the documents are the two states of `GET /`
 * plus the one unrelated additive path.
 */

import type { ApprovedBreakingChange, ApprovalRecord } from "../src/openapi-approvals.js";
import type { ApiDocument, ApiOperation } from "../src/operation-set.js";
import { operationsFromOpenApi } from "../src/operation-set.js";
import { doc, op } from "./openapi-diff-builders.js";

export const AGENT_DOCUMENT = "agent-openapi.json";
export const USERS_DOCUMENT = "users-openapi.json";

/** `GET /` still advertised: the shape an entry's removal is not realised in. */
export const ROOT_ADVERTISED: ApiDocument = doc({ "/": { get: op() } });
/** `GET /` retired: the shape this card lands. */
export const ROOT_RETIRED: ApiDocument = doc({});
/** `/` surviving as another method: the path an `endpoint-removed` entry awaits. */
export const ROOT_AS_POST: ApiDocument = doc({ "/": { post: op() } });
/** An unrelated additive path. */
export const WITH_NEW_ROUTE: ApiDocument = doc({ "/v1/added": { get: op() } });

/** What each shape advertises: the state an entry's removal is judged in. */
export const ROOT_ADVERTISED_OPERATIONS: readonly ApiOperation[] = operationsFromOpenApi(ROOT_ADVERTISED);
export const ROOT_RETIRED_OPERATIONS: readonly ApiOperation[] = operationsFromOpenApi(ROOT_RETIRED);
export const ROOT_AS_POST_OPERATIONS: readonly ApiOperation[] = operationsFromOpenApi(ROOT_AS_POST);

/** The entry this card lands: the dated, argued removal of the agent root. */
export const RECORDED_ROOT_REMOVAL: ApprovedBreakingChange = {
  document: AGENT_DOCUMENT, method: "GET", path: "/", kind: "endpoint-removed",
  issue: "#1596", approved: "2026-09-15",
};

/** The near-miss variants every matching case builds from the canonical entry. */
export function recordedRootRemoval(overrides: Partial<ApprovedBreakingChange> = {}): ApprovedBreakingChange {
  return { ...RECORDED_ROOT_REMOVAL, ...overrides };
}

/** The record a run reads for one document's approvals. */
export function approvalRecord(
  document: string, approvals: readonly ApprovedBreakingChange[],
): ApprovalRecord {
  return { document, approvals };
}
