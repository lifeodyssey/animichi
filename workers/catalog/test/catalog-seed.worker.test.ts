/**
 * Offline guard for the spike seed fixtures (#363).
 *
 * The spikes only run when Neon Local credentials are present, so fixture rot
 * used to stay invisible until a live run. These assertions run in the always-on
 * worker pool and fail the moment a fixture stops matching the shared contract.
 */

import { describe, expect, it } from "vitest";
import {
  aliasInsert,
  aliasSeed,
  ambiguousOutcome,
  candidateOf,
  pointInsert,
  pointSeed,
  resolvedOutcome,
  workInsert,
  workSeed,
} from "./fixtures/catalog-seed";

const beta = workSeed("1002", "Beta");
const alpha = workSeed("1001", "Alpha");

describe("catalog seed fixtures are contract-derived", () => {
  it("rejects a work id that `pointsByWorkId` would reject with a 400", () => {
    expect(() => workSeed("beta", "Beta")).toThrow();
  });

  it("accepts a Bangumi-style subject id", () => {
    expect(workSeed("1002", "Beta").workId).toBe("1002");
  });

  it("rejects an out-of-range latitude", () => {
    expect(() => pointSeed("p", beta, "Bad", 91, 139)).toThrow();
  });

  it("rejects an out-of-range longitude", () => {
    expect(() => pointSeed("p", beta, "Bad", 36, 181)).toThrow();
  });

  it("rejects a negative points_count on an expected candidate", () => {
    expect(() => candidateOf(beta, -1)).toThrow();
  });

  it("rejects a single-candidate disambiguation outcome", () => {
    expect(() => ambiguousOutcome([candidateOf(beta, 2)])).toThrow();
  });

  it("builds a resolved outcome carrying the seeded identity", () => {
    expect(resolvedOutcome(alpha, 1)).toEqual({
      outcome: "resolved",
      match: { bangumi_id: "1001", title: "Alpha", points_count: 1 },
    });
  });
});

describe("seed statements are emitted from the seed records", () => {
  it("numbers work placeholders across every row", () => {
    expect(workInsert([alpha, beta])).toEqual({
      text: "INSERT INTO bangumi (id, title) VALUES ($1, $2), ($3, $4)",
      values: ["1001", "Alpha", "1002", "Beta"],
    });
  });

  it("emits point columns without the trigger-derived location", () => {
    const seed = pointSeed("b-1", beta, "Beta Point 1", 36, 136);
    expect(pointInsert([seed]).text).toBe(
      "INSERT INTO points (id, bangumi_id, name, latitude, longitude)"
      + " VALUES ($1, $2, $3, $4, $5)",
    );
    expect(pointInsert([seed]).values).toEqual(["b-1", "1002", "Beta Point 1", 36, 136]);
  });

  it("carries the parent work id into alias rows", () => {
    const seed = aliasSeed(beta, "Shared", "shared", "bangumi", 40);
    expect(aliasInsert([seed]).values).toEqual(["1002", "Shared", "shared", "bangumi", 40]);
  });
});
