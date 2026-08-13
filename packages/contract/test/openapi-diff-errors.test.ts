/**
 * OpenAPI diff classification — error contract changes (issue #1005 AC4).
 *
 * Error responses are part of the wire contract: dropping a documented error
 * status is breaking, gaining one is additive, and a simultaneous removal and
 * addition is a renumbering (breaking). Every classified change must also
 * carry the stable breaking flag.
 */

import { describe, expect, it } from "vitest";
import { diffOpenApi } from "../src/openapi-diff.js";
import { BREAKING_KINDS, breakingKinds, doc, op } from "./openapi-diff-builders.js";

describe("error contract changes", () => {
  const baseline = doc({ "/v1/users/saved-routes": { post: op(undefined, { responses: { "200": { description: "OK" }, "404": { description: "not found" } } }) } });

  it("classifies an error response removal as breaking", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op(undefined, { responses: { "200": { description: "OK" } } }) } });
    const diff = diffOpenApi(baseline, candidate);
    expect(breakingKinds(diff)).toEqual(["error-response-removed"]);
  });

  it("classifies an error response addition as additive", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op(undefined, { responses: { "200": { description: "OK" }, "404": { description: "not found" }, "409": { description: "conflict" } } }) } });
    const diff = diffOpenApi(baseline, candidate);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["error-response-added"]);
  });

  it("classifies a renumbered error contract as breaking", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op(undefined, { responses: { "200": { description: "OK" }, "403": { description: "forbidden" } } }) } });
    const diff = diffOpenApi(baseline, candidate);
    expect(breakingKinds(diff).sort()).toEqual(["error-response-removed", "error-status-changed"]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["error-response-added"]);
  });

  it("every classified change carries the stable breaking flag", () => {
    const candidate = doc({ "/v1/users/saved-routes": { post: op(undefined, { responses: { "200": { description: "OK" }, "403": { description: "forbidden" } } }) } });
    const diff = diffOpenApi(baseline, candidate);
    const all = [...diff.breaking, ...diff.additive];
    for (const change of all) {
      expect(BREAKING_KINDS.has(change.kind)).toBe(change.breaking);
    }
    expect(all.length).toBeGreaterThan(0);
  });
});
