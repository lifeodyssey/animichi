/**
 * The approval record for intentional breaking OpenAPI changes (#1596, #1005 AC5).
 *
 * The record this module evaluates is the committed table in
 * `approved-breaking-changes.ts`: a breaking change passes the vet only when an
 * entry names it exactly — same document, method, path and kind — so a near
 * miss approves nothing and no entry can approve a whole category.
 *
 * An entry's validity is judged against the vetted document rather than the
 * diff: it holds while the removal it names is realised — an `endpoint-removed`
 * path answers no method, a `method-removed` method+path is absent — so a
 * landed approval stays valid once its own change has left the diff, while an
 * entry whose operation is still advertised fails the gate, because an approval
 * cannot precede the removal it names.
 *
 * The change vocabulary itself lives in `openapi-changes.ts`; this module owns
 * only what an entry may say and how the record is read.
 */

import { operationKey, type ApiOperation } from "./operation-set.js";
import type { ApiChange, ApiChangeKind } from "./openapi-changes.js";

/** The operation-removal kinds — the breaking kinds whose approved state the
 * vetted document alone can confirm: the entry's method and path are gone from
 * it. Every other breaking kind is a fact about a (baseline, candidate) pair
 * whose position or member an entry does not name, so it is not recordable and
 * stays fail-closed. */
export const REMOVAL_KINDS = [
  "endpoint-removed",
  "method-removed",
] as const satisfies readonly ApiChangeKind[];

/** A change kind the record can hold, because the document itself shows whether
 * the change happened. */
export type ApprovedChangeKind = (typeof REMOVAL_KINDS)[number];

/** One dated, review-governed approval of an intentional breaking change. */
export interface ApprovedBreakingChange {
  /** The published document the change lands in, e.g. `agent-openapi.json`. */
  readonly document: string;
  /** Uppercase HTTP method of the operation, e.g. `GET`. */
  readonly method: string;
  /** Route template of the operation, e.g. `/`. */
  readonly path: string;
  /** The removal approved at that operation: `endpoint-removed` (its path is
   * gone) or `method-removed` (the method+path is absent; the path itself may
   * remain). */
  readonly kind: ApprovedChangeKind;
  /** The issue that argued the change, e.g. `#1596`. */
  readonly issue: string;
  /** The ISO date (`YYYY-MM-DD`) the change was approved. */
  readonly approved: string;
}

/** The committed record, read against the one document being vetted. */
export interface ApprovalRecord {
  readonly document: string;
  readonly approvals: readonly ApprovedBreakingChange[];
}

/** An entry matched to one change it approves. */
export interface RecordedApproval {
  readonly entry: ApprovedBreakingChange;
  readonly change: ApiChange;
}

/** The record's verdict on one document's breaking changes. */
export interface ApprovalOutcome {
  readonly recorded: readonly RecordedApproval[];
  readonly unrecorded: readonly ApiChange[];
  /** Entries whose removal has not happened: the document under vetting still
   * advertises the operation they name. */
  readonly unrealised: readonly ApprovedBreakingChange[];
}

/** Whether an entry names this change exactly: same kind, method and path. */
function approves(entry: ApprovedBreakingChange, item: ApiChange): boolean {
  return entry.kind === item.kind && entry.method === item.operation.method && entry.path === item.operation.path;
}

function entryFor(
  entries: readonly ApprovedBreakingChange[], item: ApiChange,
): ApprovedBreakingChange | undefined {
  return entries.find((entry) => approves(entry, item));
}

/** The record's entries for the document under vetting; other documents'
 * approvals are neither applied nor reported as unrealised here. */
function entriesFor(record: ApprovalRecord): readonly ApprovedBreakingChange[] {
  return record.approvals.filter((entry) => entry.document === record.document);
}

/** The pairs an exact entry approved, in the diff's own order. */
function recordedApprovals(
  entries: readonly ApprovedBreakingChange[], changes: readonly ApiChange[],
): RecordedApproval[] {
  return changes.flatMap((item) => recordedPairFor(entryFor(entries, item), item));
}

/** The pair one lookup produced, or nothing when it named no change. */
function recordedPairFor(
  entry: ApprovedBreakingChange | undefined, change: ApiChange,
): readonly RecordedApproval[] {
  return entry === undefined ? [] : [{ entry, change }];
}

/** The changes no entry names: the record's unapproved remainder. */
function unrecordedChanges(
  entries: readonly ApprovedBreakingChange[], changes: readonly ApiChange[],
): readonly ApiChange[] {
  return changes.filter((item) => entryFor(entries, item) === undefined);
}

/** The operations a document advertises, keyed both ways an entry's realisation
 * is read: by operation (`GET /x`) and by path (`/x`). */
interface Advertised {
  readonly operations: ReadonlySet<string>;
  readonly paths: ReadonlySet<string>;
}

function advertisedBy(operations: readonly ApiOperation[]): Advertised {
  return {
    operations: new Set(operations.map((operation) => operationKey(operation))),
    paths: new Set(operations.map((operation) => operation.path)),
  };
}

/** Whether the approved state an entry names is realised in the vetted
 * document: an `endpoint-removed` path is gone entirely, a `method-removed`
 * method+path is absent (the path itself may remain). */
function isRealised(entry: ApprovedBreakingChange, advertised: Advertised): boolean {
  if (entry.kind === "method-removed") {
    return !advertised.operations.has(operationKey({ method: entry.method, path: entry.path }));
  }
  return !advertised.paths.has(entry.path);
}

/** The entries whose removal the vetted document has not realised yet. */
function unrealisedEntries(
  entries: readonly ApprovedBreakingChange[], advertised: Advertised,
): readonly ApprovedBreakingChange[] {
  return entries.filter((entry) => !isRealised(entry, advertised));
}

/** The three questions the gate asks of a record, answered together. */
function approvalOutcome(
  entries: readonly ApprovedBreakingChange[], changes: readonly ApiChange[], advertised: Advertised,
): ApprovalOutcome {
  return {
    recorded: recordedApprovals(entries, changes),
    unrecorded: unrecordedChanges(entries, changes),
    unrealised: unrealisedEntries(entries, advertised),
  };
}

/** Approve the breaking changes an exact entry names; report the ones no entry
 * names, and the entries whose removal is not realised in the vetted document. */
export function evaluateApprovals(
  record: ApprovalRecord, changes: readonly ApiChange[], current: readonly ApiOperation[],
): ApprovalOutcome {
  const entries = entriesFor(record);
  return approvalOutcome(entries, changes, advertisedBy(current));
}

/** The violation an entry earns while the removal it names has not happened:
 * the document under vetting still advertises the entry's path
 * (`endpoint-removed`) or its method+path (`method-removed`) — the subject
 * `isRealised` read there, so the message never names an absent operation. */
export function unrealisedApprovalMessage(entry: ApprovedBreakingChange): string {
  const operation = `${entry.method} ${entry.path}`;
  const advertised = entry.kind === "endpoint-removed" ? `path ${entry.path}` : operation;
  return (
    `unrealised approval: ${operation} ${entry.kind} in ${entry.document} ` +
    `(approved ${entry.approved} for ${entry.issue}): ${advertised} is still advertised; ` +
    "an approval cannot precede the removal it names — delete the entry, or land the removal"
  );
}

/** How a recorded approval reads in the CI log, next to the change it waived. */
export function approvalProvenance(entry: ApprovedBreakingChange): string {
  return `recorded ${entry.approved} for ${entry.issue} in ${entry.document}`;
}
