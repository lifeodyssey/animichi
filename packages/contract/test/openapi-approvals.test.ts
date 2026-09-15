/**
 * The approval record's matching and realisation rules (#1596, #1005 AC5).
 *
 * Matching: a breaking change is approved only by an exact entry — same
 * document, method, path and kind — so a near miss approves nothing. Validity:
 * an entry is valid while the removal it names is realised in the document
 * being vetted, i.e. the operation is gone from it. That keeps a landed
 * approval valid after its own change has left the diff, and fails the gate
 * while the operation is still advertised, so an approval can never precede the
 * removal it names. Every case builds its own record and its own operation set,
 * so the mechanism is pinned without depending on which entries the repository
 * currently carries.
 *
 * test-type: unit.
 */

import { describe, expect, it } from "vitest";
import { change } from "../src/openapi-changes.js";
import {
  evaluateApprovals,
  unrealisedApprovalMessage,
} from "../src/openapi-approvals.js";
import { diffOpenApi } from "../src/openapi-diff.js";
import { operationsFromOpenApi } from "../src/operation-set.js";
import { doc, op } from "./openapi-diff-builders.js";
import {
  AGENT_DOCUMENT,
  ROOT_ADVERTISED,
  ROOT_ADVERTISED_OPERATIONS,
  ROOT_AS_POST_OPERATIONS,
  ROOT_RETIRED,
  ROOT_RETIRED_OPERATIONS,
  USERS_DOCUMENT,
  approvalRecord,
  recordedRootRemoval,
} from "./openapi-approvals-builders.js";

const ROOT_REMOVAL = diffOpenApi(ROOT_ADVERTISED, ROOT_RETIRED).breaking;

describe("a classified change carries the operation it was found under", () => {
  it("names the operation of a removed endpoint", () => {
    expect(ROOT_REMOVAL.map((item) => item.operation)).toEqual([{ method: "GET", path: "/" }]);
  });

  it("names the operation of a schema change inside it", () => {
    const baseline = doc({ "/v1/chat": { post: op({ type: "object", properties: { id: { type: "string" } } }) } });
    const candidate = doc({ "/v1/chat": { post: op({ type: "object", properties: {} }) } });
    const caused = diffOpenApi(baseline, candidate).breaking;
    expect(caused.map((item) => item.kind)).toEqual(["schema-property-removed"]);
    expect(caused.map((item) => item.operation)).toEqual([{ method: "POST", path: "/v1/chat" }]);
  });
});

describe("an entry approves exactly the change it names", () => {
  it("approves the change named by an exact entry", () => {
    const outcome = evaluateApprovals(approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval()]), ROOT_REMOVAL, ROOT_RETIRED_OPERATIONS);
    expect(outcome.recorded.map(({ change: item }) => item.message)).toEqual(["GET / was removed"]);
    expect(outcome.unrecorded).toEqual([]);
    expect(outcome.unrealised).toEqual([]);
  });

  it("approves nothing when the method differs", () => {
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval({ method: "POST" })]);
    const outcome = evaluateApprovals(record, ROOT_REMOVAL, ROOT_RETIRED_OPERATIONS);
    expect(outcome.recorded).toEqual([]);
    expect(outcome.unrecorded.map((item) => item.kind)).toEqual(["endpoint-removed"]);
    expect(outcome.unrealised).toEqual([]);
  });

  it("approves nothing when the path differs", () => {
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval({ path: "/healthz" })]);
    const outcome = evaluateApprovals(record, ROOT_REMOVAL, ROOT_RETIRED_OPERATIONS);
    expect(outcome.recorded).toEqual([]);
    expect(outcome.unrecorded.map((item) => item.kind)).toEqual(["endpoint-removed"]);
    expect(outcome.unrealised).toEqual([]);
  });

  it("approves nothing when the change kind differs", () => {
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval({ kind: "method-removed" })]);
    const outcome = evaluateApprovals(record, ROOT_REMOVAL, ROOT_RETIRED_OPERATIONS);
    expect(outcome.recorded).toEqual([]);
    expect(outcome.unrecorded.map((item) => item.kind)).toEqual(["endpoint-removed"]);
    expect(outcome.unrealised).toEqual([]);
  });

  it("approves nothing when the change is not listed", () => {
    const outcome = evaluateApprovals(approvalRecord(AGENT_DOCUMENT, []), ROOT_REMOVAL, ROOT_RETIRED_OPERATIONS);
    expect(outcome.recorded).toEqual([]);
    expect(outcome.unrecorded.map((item) => item.kind)).toEqual(["endpoint-removed"]);
    expect(outcome.unrealised).toEqual([]);
  });
});

describe("an entry is scoped to its document", () => {
  it("neither approves nor reports outside the document it names", () => {
    const record = approvalRecord(USERS_DOCUMENT, [recordedRootRemoval()]);
    const outcome = evaluateApprovals(record, ROOT_REMOVAL, ROOT_RETIRED_OPERATIONS);
    expect(outcome.recorded).toEqual([]);
    expect(outcome.unrecorded.map((item) => item.kind)).toEqual(["endpoint-removed"]);
    expect(outcome.unrealised).toEqual([]);
  });
});

describe("an entry is valid while the removal it names is realised", () => {
  it("stays valid once the removal has landed and the diff is empty", () => {
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval()]);
    const outcome = evaluateApprovals(record, [], ROOT_RETIRED_OPERATIONS);
    expect(outcome.recorded).toEqual([]);
    expect(outcome.unrecorded).toEqual([]);
    expect(outcome.unrealised).toEqual([]);
  });

  it("fails while the document still advertises the endpoint it names", () => {
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval()]);
    const outcome = evaluateApprovals(record, [], ROOT_ADVERTISED_OPERATIONS);
    expect(outcome.recorded).toEqual([]);
    expect(outcome.unrealised.map((item) => item.issue)).toEqual(["#1596"]);
  });

  it("awaits an endpoint removal while the path still answers another method", () => {
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval()]);
    const outcome = evaluateApprovals(record, ROOT_REMOVAL, ROOT_AS_POST_OPERATIONS);
    expect(outcome.unrealised.map((item) => item.kind)).toEqual(["endpoint-removed"]);
  });

  it("approves and realises a method removal on a surviving path", () => {
    const before = doc({ "/v1/chat": { get: op(), post: op() } });
    const after = doc({ "/v1/chat": { post: op() } });
    const removal = diffOpenApi(before, after).breaking;
    const entry = recordedRootRemoval({ path: "/v1/chat", kind: "method-removed" });
    const outcome = evaluateApprovals(approvalRecord(AGENT_DOCUMENT, [entry]), removal, operationsFromOpenApi(after));
    expect(outcome.recorded.map(({ change: item }) => item.kind)).toEqual(["method-removed"]);
    expect(outcome.unrecorded).toEqual([]);
    expect(outcome.unrealised).toEqual([]);
  });
});

describe("the gate reports an unrealised approval with the removal it awaits", () => {
  it("names the path, not the absent method, when another method keeps the path", () => {
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval()]);
    const outcome = evaluateApprovals(record, ROOT_REMOVAL, ROOT_AS_POST_OPERATIONS);
    expect(outcome.unrealised.map(unrealisedApprovalMessage)).toEqual([
      "unrealised approval: GET / endpoint-removed in agent-openapi.json (approved 2026-09-15 for #1596): " +
        "path / is still advertised; an approval cannot precede the removal it names — delete the entry, or land the removal",
    ]);
  });

  it("names the method and path a method removal awaits", () => {
    const entry = recordedRootRemoval({ path: "/v1/chat", kind: "method-removed" });
    expect(unrealisedApprovalMessage(entry)).toBe(
      "unrealised approval: GET /v1/chat method-removed in agent-openapi.json (approved 2026-09-15 for #1596): " +
        "GET /v1/chat is still advertised; an approval cannot precede the removal it names — delete the entry, or land the removal",
    );
  });
});

describe("the change vocabulary stays the one severity table", () => {
  it("marks an endpoint removal breaking and an addition additive", () => {
    const operation = { method: "GET", path: "/" };
    expect(change("endpoint-removed", "GET / was removed", operation).breaking).toBe(true);
    expect(change("endpoint-added", "GET / was added", operation).breaking).toBe(false);
  });
});
