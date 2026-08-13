/**
 * OpenAPI diff classification — endpoint changes (issue #1005 AC4).
 *
 * Endpoint-level changes (path/method additions and removals) and their
 * breaking/additive severity. Route removals break the wire contract; a
 * method removal on a surviving path is still breaking; additions are
 * additive.
 */

import { describe, expect, it } from "vitest";
import { diffOpenApi } from "../src/openapi-diff.js";
import { breakingKinds, doc, op } from "./openapi-diff-builders.js";

const ROUTE = doc({ "/v1/users/saved-routes": { post: op() } });

describe("endpoint changes", () => {
  it("classifies an endpoint removal as breaking", () => {
    const diff = diffOpenApi(ROUTE, doc({}));
    expect(breakingKinds(diff)).toEqual(["endpoint-removed"]);
    expect(diff.additive).toEqual([]);
  });

  it("classifies an endpoint addition as additive", () => {
    const diff = diffOpenApi(doc({}), ROUTE);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.map((change) => change.kind)).toEqual(["endpoint-added"]);
  });

  it("classifies a method removal as breaking (path stays)", () => {
    const diff = diffOpenApi(
      doc({ "/v1/users/saved-routes": { post: op() } }),
      doc({ "/v1/users/saved-routes": {} }),
    );
    expect(breakingKinds(diff)).toEqual(["method-removed"]);
  });

  it("classifies a method addition as additive (path stays)", () => {
    const diff = diffOpenApi(
      doc({ "/v1/users/saved-routes": {} }),
      doc({ "/v1/users/saved-routes": { post: op() } }),
    );
    expect(diff.additive.map((change) => change.kind)).toEqual(["method-added"]);
  });
});
