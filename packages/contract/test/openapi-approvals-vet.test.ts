/**
 * The vet's use of the approval record (#1596, #1005 AC5).
 *
 * The gate reads the record of the document it vets only: a breaking change
 * passes only with an exactly matching entry, and an entry fails the run as
 * unrealised while the document still advertises the operation it names. The
 * post-merge case is the point of the rule — a recorded removal stays valid
 * once the change has landed and the diff no longer carries it — and the manual
 * flag still waives a run without consulting the record.
 *
 * test-type: unit.
 */

import { describe, expect, it } from "vitest";
import { unrealisedApprovalMessage } from "../src/openapi-approvals.js";
import { vetOpenApiDiff } from "../src/openapi-vet.js";
import { doc, op } from "./openapi-diff-builders.js";
import {
  AGENT_DOCUMENT,
  ROOT_ADVERTISED,
  ROOT_RETIRED,
  approvalRecord,
  recordedRootRemoval,
} from "./openapi-approvals-builders.js";

describe("the vet decides with the record, not around it", () => {
  it("approves a removal the record names, and reports the approval it used", () => {
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval()]);
    const result = vetOpenApiDiff(ROOT_ADVERTISED, ROOT_RETIRED, { allowBreaking: false, record });
    expect(result.approved).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.recorded.map(({ entry: used }) => used.issue)).toEqual(["#1596"]);
  });

  it("approves the document whose recorded removal has already landed", () => {
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval()]);
    const result = vetOpenApiDiff(ROOT_RETIRED, ROOT_RETIRED, { allowBreaking: false, record });
    expect(result.approved).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails closed while the document still advertises the recorded operation", () => {
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval()]);
    const result = vetOpenApiDiff(ROOT_ADVERTISED, ROOT_ADVERTISED, { allowBreaking: false, record });
    expect(result.approved).toBe(false);
    expect(result.violations).toContain(unrealisedApprovalMessage(recordedRootRemoval()));
  });

  it("fails a near miss with the change it does not approve", () => {
    const entry = recordedRootRemoval({ path: "/healthz" });
    const result = vetOpenApiDiff(ROOT_ADVERTISED, ROOT_RETIRED, {
      allowBreaking: false,
      record: approvalRecord(AGENT_DOCUMENT, [entry]),
    });
    expect(result.approved).toBe(false);
    expect(result.violations).toEqual(["GET / was removed"]);
  });

  it("fails a change the record does not list", () => {
    const result = vetOpenApiDiff(ROOT_ADVERTISED, ROOT_RETIRED, { allowBreaking: false });
    expect(result.approved).toBe(false);
    expect(result.violations).toEqual(["GET / was removed"]);
    expect(result.recorded).toEqual([]);
  });

  it("lets the manual flag waive breaking changes without consulting the record", () => {
    const entry = recordedRootRemoval({ path: "/healthz" });
    const result = vetOpenApiDiff(ROOT_ADVERTISED, ROOT_RETIRED, {
      allowBreaking: true,
      record: approvalRecord(AGENT_DOCUMENT, [entry]),
    });
    expect(result.approved).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.recorded).toEqual([]);
  });

  it("still rejects an additive change that skips a future major deprecation", () => {
    const superseded = doc({ "/v1/chat": { post: op() } });
    const future = doc({ "/v1/chat": { post: op() }, "/v2/chat": { post: op() } });
    const record = approvalRecord(AGENT_DOCUMENT, [recordedRootRemoval()]);
    const result = vetOpenApiDiff(superseded, future, { allowBreaking: false, record });
    expect(result.approved).toBe(false);
    expect(result.violations).toContain(
      "POST /v2/chat introduces a future major path; POST /v1/chat must be deprecated: true with an x-sunset date",
    );
  });
});
