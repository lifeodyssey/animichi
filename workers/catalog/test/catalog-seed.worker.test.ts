/**
 * Offline guard for the catalog seed fixtures (#363, #456).
 *
 * The Docker-backed integration lane owns the live database assertions, so fixture
 * rot there is visible only when that lane runs. These assertions run in the
 * always-on worker pool and fail the moment a fixture stops matching the shared
 * contract — or an integration suite stops seeding through the builders.
 */

import { describe, expect, it } from "vitest";
import {
  aliasInsert,
  aliasSeed,
  ambiguousOutcome,
  candidateOf,
  clusterVersionInsert,
  clusterVersionSeed,
  pointInsert,
  pointSeed,
  resolvedOutcome,
  workInsert,
  workSeed,
} from "./fixtures/catalog-seed";

const beta = workSeed("1002", "Beta");
const alpha = workSeed("1001", "Alpha");

describe("catalog seed fixtures are contract-derived", () => {
  it("rejects a work id that `pointsByBangumiId` would reject with a 400", () => {
    expect(() => workSeed("beta", "Beta")).toThrow();
  });

  it("accepts a Bangumi-style subject id", () => {
    expect(workSeed("1002", "Beta").workId).toBe("1002");
  });

  it("rejects a negative points_count on a work seed", () => {
    expect(() => workSeed("1002", "Beta", { pointsCount: -1 })).toThrow();
  });

  it("rejects an out-of-range latitude", () => {
    expect(() => pointSeed("p", beta, "Bad", 91, 139)).toThrow();
  });

  it("rejects an out-of-range longitude", () => {
    expect(() => pointSeed("p", beta, "Bad", 36, 181)).toThrow();
  });

  it("rejects a fractional scene time the contract types as an integer", () => {
    expect(() => pointSeed("p", beta, "Bad", 36, 139, { timeSeconds: 1.5 })).toThrow();
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

describe("work seed statements are emitted from the seed records", () => {
  it("numbers work placeholders across every row", () => {
    expect(workInsert([alpha, beta])).toEqual({
      text: "INSERT INTO bangumi (id, title, title_cn, eps_count, rating, points_count)"
        + " VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)",
      values: ["1001", "Alpha", null, null, null, 0, "1002", "Beta", null, null, null, 0],
    });
  });

  it("carries every supplied work column into the insert", () => {
    const work = workSeed("1002", "Beta", { titleCn: "贝塔", epsCount: 12, rating: 8.5, pointsCount: 4 });
    expect(workInsert([work]).values).toEqual(["1002", "Beta", "贝塔", 12, 8.5, 4]);
  });
});

describe("point and relationship seed statements are emitted from the seed records", () => {
  it("writes the source geometry, never the derived scalars", () => {
    const seed = pointSeed("b-1", beta, "Beta Point 1", 36, 136);
    expect(pointInsert([seed]).text).toBe(
      "INSERT INTO points (id, bangumi_id, name, episode, time_seconds, image, city, location)"
      + " VALUES ($1, $2, $3, $4, $5, $6, $7,"
      + " ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography)",
    );
    expect(pointInsert([seed]).values).toEqual(["b-1", "1002", "Beta Point 1", null, 0, null, null, 136, 36]);
  });

  it("carries every supplied point column into the insert", () => {
    const seed = pointSeed("b-1", beta, "Beta Point 1", 36, 136, {
      episode: 3, timeSeconds: 42, image: "https://img/b-1.jpg", city: "Kuki",
    });
    expect(pointInsert([seed]).values).toEqual([
      "b-1", "1002", "Beta Point 1", 3, 42, "https://img/b-1.jpg", "Kuki", 136, 36,
    ]);
  });

  it("numbers point placeholders across every row", () => {
    const first = pointSeed("b-1", beta, "Beta Point 1", 36, 136);
    const second = pointSeed("b-2", beta, "Beta Point 2", 35, 135);
    expect(pointInsert([first, second]).values).toEqual([
      "b-1", "1002", "Beta Point 1", null, 0, null, null, 136, 36,
      "b-2", "1002", "Beta Point 2", null, 0, null, null, 135, 35,
    ]);
    expect(pointInsert([first, second]).text).toContain("$10");
  });

  it("never names the generated coordinate columns (#1628)", () => {
    const { text } = pointInsert([pointSeed("b-1", beta, "Beta Point 1", 36, 136)]);
    expect(text).not.toContain("latitude");
    expect(text).not.toContain("longitude");
  });

  it("carries the parent work id into alias rows", () => {
    const seed = aliasSeed(beta, "Shared", "shared", "bangumi", 40);
    expect(aliasInsert([seed]).values).toEqual(["1002", "Shared", "shared", "bangumi", 40]);
  });

  it("emits a cluster version from its work seed", () => {
    expect(clusterVersionInsert([clusterVersionSeed(beta, 1, true)])).toEqual({
      text: "INSERT INTO cluster_version (bangumi_id, version, is_current) VALUES ($1, $2, $3)",
      values: ["1002", 1, true],
    });
  });
});

/**
 * The builder-covered tables, and the one shape a suite may not spell itself.
 *
 * An integration suite that hand-writes `INSERT INTO` one of these is seeding
 * the contract's own records without the contract — exactly the drift #363 and
 * #449 removed from the fixtures. A generated set insert (`INSERT ... SELECT
 * ... generate_series`) carries no per-row contract value and lives in its own
 * fixture module instead.
 */
const BUILDER_TABLES: readonly string[] = ["bangumi", "points", "aliases", "cluster_version"];
const RAW_SEED_INSERT = /\bINSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)/gi;

/** Every `path: table` in `tree` that hand-writes a builder-covered INSERT. */
function rawSeedInserts(tree: Readonly<Record<string, string>>): string[] {
  return Object.entries(tree).flatMap(([path, source]) => {
    const tables = [...source.matchAll(RAW_SEED_INSERT)]
      .map((match) => (match[1] ?? "").toLowerCase())
      .filter((table) => BUILDER_TABLES.includes(table));
    return [...new Set(tables)].map((table) => `${path}: ${table}`);
  });
}

// `?raw` inlines each suite at transform time, so this runs in workerd without
// touching its sandboxed filesystem — the technique `dependency-rule.worker.test.ts` uses.
const integrationSuites = import.meta.glob<string>("./*.integration.test.ts", {
  query: "?raw",
  eager: true,
  import: "default",
});

describe("catalog integration suites seed through the builders", () => {
  it("flags a raw INSERT INTO a builder-covered table", () => {
    expect(rawSeedInserts({
      "test/probe.integration.test.ts": "await pool.query(\"INSERT INTO points (id, name) VALUES ('p', 'n')\");\n",
    })).toEqual(["test/probe.integration.test.ts: points"]);
  });

  it("ignores a table the builders do not cover", () => {
    expect(rawSeedInserts({
      "test/probe.integration.test.ts": "INSERT INTO ingest_jobs (work_id) VALUES ('w')\n",
    })).toEqual([]);
  });

  it("loads the integration suites as text", () => {
    expect(Object.keys(integrationSuites)).toContain("./catalog-api.integration.test.ts");
  });

  it("keeps every catalog integration suite on the builders", () => {
    expect(rawSeedInserts(integrationSuites)).toEqual([]);
  });
});
