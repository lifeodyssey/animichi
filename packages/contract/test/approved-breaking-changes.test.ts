/**
 * The committed approval record (#1596, #1005 AC5).
 *
 * The record is hand-written data a reviewer reads, so its own hygiene is
 * gated: every entry names a published document, a removal kind, an uppercase
 * method, a route path, the issue that argued the change and an ISO approval
 * date, and no entry hides behind a duplicate. An entry that fails any of these
 * can never approve its change — the gate reads the record, so a typo would
 * silently drop an approval rather than fail loudly. The kinds are the
 * operation removals and nothing else: they are the only breaking kinds whose
 * realised state the vetted document itself can confirm (#1596).
 *
 * Each rule asserts the record is non-empty before looping over it, so the
 * suite cannot pass by the record having quietly become `[]`; the exact-entry
 * case below is the same pin from the other side.
 *
 * test-type: unit.
 */

import { describe, expect, it } from "vitest";
import { APPROVED_BREAKING_CHANGES } from "../src/approved-breaking-changes.js";
import { change } from "../src/openapi-changes.js";
import { REMOVAL_KINDS, type ApprovedBreakingChange } from "../src/openapi-approvals.js";

const PUBLISHED_DOCUMENTS = ["openapi.json", "users-openapi.json", "agent-openapi.json"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISSUE_REFERENCE = /^#\d+$/;

function entryKey(entry: ApprovedBreakingChange): string {
  return `${entry.document} ${entry.method} ${entry.path} ${entry.kind}`;
}

describe("every entry names exactly one breaking change", () => {
  it("names a published document", () => {
    expect(APPROVED_BREAKING_CHANGES.length).toBeGreaterThan(0);
    for (const entry of APPROVED_BREAKING_CHANGES) expect(PUBLISHED_DOCUMENTS).toContain(entry.document);
  });

  it("names a removal kind, the only kind the document itself can confirm", () => {
    expect(APPROVED_BREAKING_CHANGES.length).toBeGreaterThan(0);
    for (const entry of APPROVED_BREAKING_CHANGES) {
      const severity = change(entry.kind, "", { method: entry.method, path: entry.path });
      expect(severity.breaking).toBe(true);
      expect(REMOVAL_KINDS).toContain(entry.kind);
    }
  });

  it("supports exactly the operation-removal kinds", () => {
    expect(REMOVAL_KINDS).toEqual(["endpoint-removed", "method-removed"]);
  });

  it("names an uppercase method and a route path", () => {
    expect(APPROVED_BREAKING_CHANGES.length).toBeGreaterThan(0);
    for (const entry of APPROVED_BREAKING_CHANGES) {
      expect(entry.method).toBe(entry.method.toUpperCase());
      expect(entry.method.length).toBeGreaterThan(0);
      expect(entry.path.startsWith("/")).toBe(true);
    }
  });

  it("carries the issue that argued it and the date it was approved", () => {
    expect(APPROVED_BREAKING_CHANGES.length).toBeGreaterThan(0);
    for (const entry of APPROVED_BREAKING_CHANGES) {
      expect(entry.issue).toMatch(ISSUE_REFERENCE);
      expect(entry.approved).toMatch(ISO_DATE);
      // A UTC round trip rejects impossible days (`2026-02-31`), which `Date.parse` normalises.
      expect(new Date(`${entry.approved}T00:00:00.000Z`).toISOString().slice(0, 10))
        .toBe(entry.approved);
    }
  });

  it("appears once, so no entry can hide behind a duplicate", () => {
    const keys = APPROVED_BREAKING_CHANGES.map(entryKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(0);
  });
});

describe("the approval this card lands", () => {
  it("records the retired agent root for #1596", () => {
    expect(APPROVED_BREAKING_CHANGES).toContainEqual({
      document: "agent-openapi.json",
      method: "GET",
      path: "/",
      kind: "endpoint-removed",
      issue: "#1596",
      approved: "2026-09-15",
    });
  });
});
