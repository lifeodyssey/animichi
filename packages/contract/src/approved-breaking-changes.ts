/**
 * The committed record of intentional breaking OpenAPI changes (#1596).
 *
 * The published-contract gate (`scripts/vet-openapi-baseline.ts`, run by this
 * package's `test` script and by CI's affected lane) fails on every breaking
 * change to a published document. This file is the one place a breaking change
 * is approved: an entry names the change exactly — document, method, path and
 * kind — together with the issue that argued it and the date it was approved,
 * and `evaluateApprovals` (`openapi-approvals.ts`) approves nothing else. There
 * is no wildcard field, so an entry can never approve a category, and a near
 * miss approves nothing.
 *
 * An entry is valid while the removal it names is realised in the document the
 * gate vets — an `endpoint-removed` path answers no method, a `method-removed`
 * method+path is absent — so a landed approval stays valid once its own change
 * has left the diff and needs no cleanup commit. An entry whose operation is
 * still advertised fails the gate, because an approval cannot precede the
 * removal it names; delete the entry if the removal is dropped. Only the
 * operation-removal kinds are recordable
 * (`REMOVAL_KINDS`): they are the breaking kinds whose approved state the
 * document itself can confirm, while a schema or error-contract change names
 * neither its position nor its member here and would need the baseline to be
 * judged at all. `--allow-breaking` is the manual, non-gate flag: it waives
 * every breaking change in one run and never reads this record.
 *
 * Add an entry only with the reviewable argument for the change in the issue it
 * names; the hygiene rules every entry is held to live in
 * `test/approved-breaking-changes.test.ts`.
 */

import type { ApprovedBreakingChange } from "./openapi-approvals.js";

export const APPROVED_BREAKING_CHANGES: readonly ApprovedBreakingChange[] = [
  {
    document: "agent-openapi.json",
    method: "GET",
    path: "/",
    kind: "endpoint-removed",
    issue: "#1596",
    approved: "2026-09-15",
  },
  {
    document: "agent-openapi.json",
    method: "POST",
    path: "/v1/feedback",
    kind: "endpoint-removed",
    issue: "#1595",
    approved: "2026-09-15",
  },
];
