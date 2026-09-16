/**
 * The approval record's hygiene, gated because a typo would silently drop an
 * approval rather than fail loudly. Each rule asserts the record is non-empty
 * before looping, so the suite cannot pass by the record having become `[]`.
 *
 * test-type: unit.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readApprovedBreakingChanges } from "../src/approved-breaking-changes.js";
import { change } from "../src/openapi-changes.js";
import { REMOVAL_KINDS, type ApprovedBreakingChange } from "../src/openapi-approvals.js";

const RECORD = readApprovedBreakingChanges();
const PUBLISHED_DOCUMENTS = ["openapi.json", "users-openapi.json", "agent-openapi.json"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISSUE_REFERENCE = /^#\d+$/;

function entryKey(entry: ApprovedBreakingChange): string {
  return `${entry.document} ${entry.method} ${entry.path} ${entry.kind}`;
}

describe("every entry names exactly one breaking change", () => {
  it("names a published document", () => {
    expect(RECORD.length).toBeGreaterThan(0);
    for (const entry of RECORD) expect(PUBLISHED_DOCUMENTS).toContain(entry.document);
  });

  it("names a removal kind, the only kind the document itself can confirm", () => {
    expect(RECORD.length).toBeGreaterThan(0);
    for (const entry of RECORD) {
      const severity = change(entry.kind, "", { method: entry.method, path: entry.path });
      expect(severity.breaking).toBe(true);
      expect(REMOVAL_KINDS).toContain(entry.kind);
    }
  });

  it("supports exactly the operation-removal kinds", () => {
    expect(REMOVAL_KINDS).toEqual(["endpoint-removed", "method-removed"]);
  });

  it("names an uppercase method and a route path", () => {
    expect(RECORD.length).toBeGreaterThan(0);
    for (const entry of RECORD) {
      expect(entry.method).toBe(entry.method.toUpperCase());
      expect(entry.method.length).toBeGreaterThan(0);
      expect(entry.path.startsWith("/")).toBe(true);
    }
  });

  it("carries the issue that argued it and the date it was approved", () => {
    expect(RECORD.length).toBeGreaterThan(0);
    for (const entry of RECORD) {
      expect(entry.issue).toMatch(ISSUE_REFERENCE);
      expect(entry.approved).toMatch(ISO_DATE);
      // A UTC round trip rejects impossible days (`2026-02-31`), which `Date.parse` normalises.
      expect(new Date(`${entry.approved}T00:00:00.000Z`).toISOString().slice(0, 10))
        .toBe(entry.approved);
    }
  });

  it("appears once, so no entry can hide behind a duplicate", () => {
    const keys = RECORD.map(entryKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(0);
  });
});

describe("the approval this card lands", () => {
  it("records the retired agent root for #1596", () => {
    expect(RECORD).toContainEqual({
      document: "agent-openapi.json",
      method: "GET",
      path: "/",
      kind: "endpoint-removed",
      issue: "#1596",
      approved: "2026-09-15",
    });
  });

  // #1597 retires the three uncalled catalog reads. Each name is exact, so a
  // typo cannot silently drop the approval the vet needs.
  it("records the three retired catalog reads for #1597", () => {
    for (const path of ["/v1/search/preview", "/v1/bangumi/{bangumi_id}/guide", "/v1/bangumi/nearby"]) {
      expect(RECORD).toContainEqual({
        document: "agent-openapi.json",
        method: "GET",
        path,
        kind: "endpoint-removed",
        issue: "#1597",
        approved: "2026-09-15",
      });
    }
  });

  // #1604 deletes the photo search surface rather than rebuilding it, so the
  // container forward loses its last two mounted routes. Both names are exact.
  it("records the two deleted photo-search routes for #1604", () => {
    for (const path of ["/v1/photo-search", "/v1/photo-search/confirm"]) {
      expect(RECORD).toContainEqual({
        document: "agent-openapi.json",
        method: "POST",
        path,
        kind: "endpoint-removed",
        issue: "#1604",
        approved: "2026-09-16",
      });
    }
  });
});

describe("a file that is not an entry fails the record, naming that file", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "approval-entry-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function directoryWithEntry(entry: object): string {
    writeFileSync(join(directory, "bad-entry.json"), JSON.stringify(entry), "utf8");
    return directory;
  }

  // The record is read, never compiled: a file that is not an entry would
  // approve nothing, so the read fails loudly and names the file.
  it("rejects a file that lost its issue", () => {
    const lost = { document: "agent-openapi.json", method: "GET", path: "/",
      kind: "endpoint-removed", approved: "2026-09-15" };
    expect(() => readApprovedBreakingChanges(directoryWithEntry(lost))).toThrow(/bad-entry\.json/);
  });

  it("rejects a file approved on a day that does not exist", () => {
    const impossible = { document: "agent-openapi.json", method: "GET", path: "/",
      kind: "endpoint-removed", issue: "#1596", approved: "2026-02-31" };
    expect(() => readApprovedBreakingChanges(directoryWithEntry(impossible))).toThrow(/bad-entry\.json/);
  });

  it("rejects a file whose kind is not an operation removal", () => {
    const unknown = { document: "agent-openapi.json", method: "GET", path: "/",
      kind: "path-removed", issue: "#1596", approved: "2026-09-15" };
    expect(() => readApprovedBreakingChanges(directoryWithEntry(unknown))).toThrow(/bad-entry\.json/);
  });

  it("rejects a file that is not JSON", () => {
    writeFileSync(join(directory, "bad-entry.json"), "{ not json", "utf8");
    expect(() => readApprovedBreakingChanges(directory)).toThrow(/bad-entry\.json/);
  });

  it("rejects a stray file, which no run would ever read as an entry", () => {
    writeFileSync(join(directory, "notes.md"), "one .json file per entry\n", "utf8");
    expect(() => readApprovedBreakingChanges(directory)).toThrow(/notes\.md/);
  });
});
