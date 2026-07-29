import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import {
  routeTooManyClusters,
  routeTooManyPoints,
  upstreamUnavailable,
  workNotFound,
} from "../src/lib/errors";

/** Unit coverage for typed catalog oRPC error constructors. */
describe("catalog error constructors", () => {
  it("constructs ROUTE_TOO_MANY_CLUSTERS with mirrored wire fields", () => {
    const err = routeTooManyClusters(51, 50);
    expect(err).toBeInstanceOf(ORPCError);
    expect(err.toJSON()).toEqual({
      defined: true,
      code: "ROUTE_TOO_MANY_CLUSTERS",
      status: 422,
      message: "Route exceeds the maximum number of areas",
      data: { cluster_count: 51, max_clusters: 50 },
    });
  });

  it("constructs ROUTE_TOO_MANY_POINTS with mirrored wire fields", () => {
    const err = routeTooManyPoints(501, 500);
    expect(err.toJSON()).toEqual({
      defined: true,
      code: "ROUTE_TOO_MANY_POINTS",
      status: 400,
      message: "Too many point_ids for a single route",
      data: { point_count: 501, max_points: 500 },
    });
  });

  it("constructs WORK_NOT_FOUND with mirrored wire fields", () => {
    const err = workNotFound("123");
    expect(err.toJSON()).toEqual({
      defined: true,
      code: "WORK_NOT_FOUND",
      status: 404,
      message: "No pilgrimage points for this work",
      data: { bangumi_id: "123" },
    });
  });

  it("constructs UPSTREAM_UNAVAILABLE with cause preserved", () => {
    const cause = new Error("upstream down");
    const err = upstreamUnavailable("anitabi", cause);
    expect(err.cause).toBe(cause);
    expect(err.toJSON()).toEqual({
      defined: true,
      code: "UPSTREAM_UNAVAILABLE",
      status: 502,
      message: "Upstream catalog source unavailable",
      data: { upstream: "anitabi" },
    });
  });
});
