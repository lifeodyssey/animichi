import { afterAll, beforeAll, expect, it } from "vitest";
import pg from "pg";
import { bangumiPoints } from "../src/adapters/outbound/bangumi-points";
import { NeonGazetteer } from "../src/adapters/outbound/neon/gazetteer";
import { overviewPointsDb } from "../src/adapters/outbound/overview-points";
import { popularBangumiDb } from "../src/adapters/outbound/popular-bangumi";
import { pointsForRoute } from "../src/adapters/outbound/route-points";
import { titleAlias } from "../src/adapters/outbound/title-alias";
import { geographyRuntimeDescriptor } from "@animichi/prisma-geography/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import postgresServerless from "@prisma/orm-postgres/serverless";
import type { CatalogPrisma } from "../src/db/prisma";
import { withJoinedTransaction } from "./fakes/fake-catalog-prisma";
import { databaseDescribe, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";
import {
  aliasInsert,
  aliasSeed,
  pointInsert,
  pointSeed,
  workInsert,
  workSeed,
} from "./fixtures/catalog-seed";

/**
 * #1629: every operation in `src/adapters/outbound/` against the REAL Prisma
 * data plane — the shape every deployed environment has, built by the committed
 * chain (#1626), not the retired Drizzle fixture.
 *
 * The adapters are driven DIRECTLY, on a runtime this file acquires, so what is
 * asserted is the operation the Worker will run and not a route's wiring.
 *
 * The oracle is the fixture: each assertion names the exact rows, their order,
 * and their shape, so a projection that renames a column, an ORDER BY that
 * loses a tiebreak, or a join that becomes inner fails here. The trigram
 * predicate's index is read back from `EXPLAIN`, and `points.latitude` —
 * a generated column on this plane — is exercised for both its read and its
 * refusal to be written.
 */

const CHIHAYAFURU = workSeed("2001", "ちはやふる");
const EMPTY_WORK = workSeed("2002", "Empty Work");

/** Episode/time/ids chosen so the declared scene order differs from the id order
 * AND from the insertion order: only `episode, time_seconds, id` yields it. */
const POINTS = [
  pointSeed("p-c", CHIHAYAFURU, "C", 35.0, 135.0),
  pointSeed("p-a", CHIHAYAFURU, "A", 35.1, 135.1),
  pointSeed("p-b", CHIHAYAFURU, "B", 35.2, 135.2),
];

/** The scene columns each point carries, applied after the geometry insert. */
const SCENE_FIELDS: readonly { readonly id: string; readonly episode: number | null; readonly timeSeconds: number | null }[] = [
  { id: "p-c", episode: 2, timeSeconds: 10 },
  { id: "p-a", episode: 1, timeSeconds: 120 },
  { id: "p-b", episode: 1, timeSeconds: 60 },
  { id: "p-null", episode: null, timeSeconds: null },
];

const POPULAR_A = workSeed("3001", "Rated");
const POPULAR_NULL_RATING = workSeed("3002", "Unrated");
const POPULAR_ZERO = workSeed("3003", "Uncounted");

const LOCATIONS = [
  { id: "nishinomiya", name: "西宮北口", kind: "station", lat: 34.7386, lng: 135.3485, source: "manual", pref: "兵庫県" },
  { id: "osaka", name: "大阪", kind: "city", lat: 34.6937, lng: 135.5023, source: "geonames", pref: "大阪府" },
];

/**
 * The alias index. The priorities are chosen so the per-place pick is
 * OBSERVABLE: `nishinomiya` matches the fuzzy term exactly through its
 * priority-20 alias and only weakly through its priority-90 one, so a read that
 * reported "the highest priority alias" instead of "the alias that scored the
 * place highest" would answer 90 and fail.
 */
const LOCATION_ALIASES: readonly (readonly (string | number)[])[] = [
  ["西宮北口", "西宮北口", "nishinomiya", "ja", 50],
  ["西宮北口駅", "西宮北口駅", "nishinomiya", "ja", 20],
  ["にしのみやきたぐち", "にしのみやきたぐち", "nishinomiya", "ja", 90],
  ["西宮北口駅前", "西宮北口駅前", "osaka", "ja", 5],
];

/** Enough unrelated aliases that the table is not trivially small, so the
 * planner's choice is a real one rather than a one-page scan. */
const FILLER_PLACES = 20_000;

let pool: pg.Pool;
let capture: PlanCapture;

/** One statement as the runtime lowered it, with its bound parameters. */
interface RecordedStatement {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** One `EXPLAIN (FORMAT JSON)` node, with the fields a plan assertion reads. */
interface PlanNode {
  node: string;
  relation?: string;
  index?: string;
  indexCondition?: string;
  children: readonly PlanNode[];
}

interface PlanCapture {
  readonly prisma: CatalogPrisma;
  /** `EXPLAIN` of the last recorded statement containing `needle`. */
  explain(needle: string): Promise<readonly PlanNode[]>;
  /**
   * The same, with `enable_seqscan` off for the duration of the EXPLAIN.
   *
   * At the plane's fixture size a sequential scan of `location_aliases` is
   * genuinely the cheaper plan, so the planner is right to take it and the
   * index's availability is invisible. Disallowing the sequential scan asks the
   * question the assertion is actually about — CAN the GIN index serve this
   * predicate — and the dropped-index mutation below shows the answer is not
   * an artefact of the setting.
   */
  explainWithoutSeqScan(needle: string): Promise<readonly PlanNode[]>;
  statements(): readonly string[];
  close(): Promise<void>;
}

/**
 * Open the production serverless client against `dsn` with a recording
 * middleware, plus an `EXPLAIN` connection beside it.
 *
 * The middleware is the only seam that sees the statement the Worker's own
 * entry lowers — the built plan is an AST, and the runtime renders it after
 * lowering, so reading SQL anywhere earlier would assert a mirror that can
 * drift.
 */
async function capturePlan(dsn: string): Promise<PlanCapture> {
  const recorded: RecordedStatement[] = [];
  const client = postgresServerless<Contract>({
    contractJson,
    extensions: [geographyRuntimeDescriptor],
    middleware: [{
      name: "outbound-plan-capture",
      beforeQuery: (plan: { sql: string; params: readonly unknown[] }) => {
        recorded.push({ text: plan.sql, params: plan.params });
      },
    }],
  });
  const runtime = await client.connect({ url: dsn });
  const explainer = new pg.Client({ connectionString: dsn });
  await explainer.connect();
  return {
    prisma: withJoinedTransaction({ builder: client.sql, executor: runtime }),
    explain: (needle) => explainRecorded(explainer, recorded, needle),
    explainWithoutSeqScan: async (needle) => {
      await explainer.query("BEGIN");
      try {
        await explainer.query("SET LOCAL enable_seqscan = off");
        return await explainRecorded(explainer, recorded, needle);
      } finally {
        await explainer.query("ROLLBACK");
      }
    },
    statements: () => recorded.map((entry) => entry.text),
    close: async () => {
      await explainer.end();
      await runtime[Symbol.asyncDispose]();
    },
  };
}

/** `EXPLAIN (FORMAT JSON)` of the last recorded statement containing `needle`. */
async function explainRecorded(
  explainer: pg.Client,
  recorded: readonly RecordedStatement[],
  needle: string,
): Promise<readonly PlanNode[]> {
  const statement = [...recorded].reverse().find((entry) => entry.text.includes(needle));
  if (statement === undefined) throw new Error(`no recorded statement contains ${needle}`);
  const { rows } = await explainer.query<{ readonly "QUERY PLAN": unknown }>(
    `EXPLAIN (FORMAT JSON) ${statement.text}`,
    statement.params.map(bindable),
  );
  return flattenPlan(rootPlan(rows[0]?.["QUERY PLAN"]));
}

/** A parameter as `pg` can bind it: scalars as they are, a geography as EWKT. */
function bindable(value: unknown): unknown {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value === null) return null;
  const candidate = value as { srid?: unknown; coordinates?: unknown };
  if (typeof candidate.srid !== "number" || !Array.isArray(candidate.coordinates)) {
    throw new TypeError("unsupported plan parameter");
  }
  const [longitude, latitude] = candidate.coordinates as [number, number];
  return `SRID=${String(candidate.srid)};POINT(${String(longitude)} ${String(latitude)})`;
}

function rootPlan(payload: unknown): PlanNode {
  if (!Array.isArray(payload) || !isRecord(payload[0])) throw new TypeError("EXPLAIN payload is malformed");
  return planNode(payload[0].Plan);
}

function flattenPlan(root: PlanNode): readonly PlanNode[] {
  return [root, ...root.children.flatMap(flattenPlan)];
}

/** Every index name the plan's nodes name. */
function indexNames(nodes: readonly PlanNode[]): readonly string[] {
  return nodes.flatMap((node) => (node.index === undefined ? [] : [node.index]));
}

function planNode(value: unknown): PlanNode {
  if (!isRecord(value) || typeof value["Node Type"] !== "string") throw new TypeError("EXPLAIN node is malformed");
  return {
    node: value["Node Type"],
    relation: typeof value["Relation Name"] === "string" ? value["Relation Name"] : undefined,
    index: typeof value["Index Name"] === "string" ? value["Index Name"] : undefined,
    indexCondition: typeof value["Index Cond"] === "string" ? value["Index Cond"] : undefined,
    children: Array.isArray(value.Plans) ? value.Plans.map(planNode) : [],
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

async function seed(): Promise<void> {
  await run(workInsert([CHIHAYAFURU, EMPTY_WORK, POPULAR_A, POPULAR_NULL_RATING, POPULAR_ZERO]));
  await run(pointInsert(POINTS));
  await run(pointInsert([pointSeed("p-null", CHIHAYAFURU, "No Scene", 35.3, 135.3)]));
  for (const scene of SCENE_FIELDS) {
    await pool.query("UPDATE points SET episode = $1, time_seconds = $2 WHERE id = $3", [
      scene.episode, scene.timeSeconds, scene.id,
    ]);
  }
  await run(aliasInsert([
    aliasSeed(CHIHAYAFURU, "ちはやふる", "ちはやふる", "bangumi", 40),
    aliasSeed(CHIHAYAFURU, "ちはやふる", "ちはやふる", "manual", 70),
    aliasSeed(EMPTY_WORK, "ちはやふる", "ちはやふる", "bangumi", 10),
  ]));
  await seedPopularRanks();
  await seedGazetteer();
}

/** Popular ranking: one rated, one with a NULL rating, one with zero points. */
async function seedPopularRanks(): Promise<void> {
  await pool.query("UPDATE bangumi SET points_count = $1, rating = $2 WHERE id = $3", [5, 9.5, POPULAR_A.workId]);
  await pool.query("UPDATE bangumi SET points_count = $1, rating = $2 WHERE id = $3", [3, null, POPULAR_NULL_RATING.workId]);
  await pool.query("UPDATE bangumi SET points_count = $1, rating = $2 WHERE id = $3", [0, 10, POPULAR_ZERO.workId]);
  await pool.query("UPDATE bangumi SET points_count = $1 WHERE id = $2", [4, CHIHAYAFURU.workId]);
  await pool.query("UPDATE bangumi SET points_count = $1 WHERE id = $2", [null, EMPTY_WORK.workId]);
}

/** Two places, an alias index that discriminates the per-place pick, and enough
 * unrelated aliases for the trigram index to be the cheaper plan. */
async function seedGazetteer(): Promise<void> {
  for (const place of LOCATIONS) {
    await pool.query(
      "INSERT INTO locations (id, name, kind, latitude, longitude, source, pref) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [place.id, place.name, place.kind, place.lat, place.lng, place.source, place.pref],
    );
  }
  await pool.query(
    `INSERT INTO location_aliases (alias, alias_normalized, location_id, lang, priority)
     VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15), ($16, $17, $18, $19, $20)`,
    LOCATION_ALIASES.flatMap((row) => [...row]),
  );
  await pool.query(
    `INSERT INTO locations (id, name, kind, latitude, longitude, source)
     SELECT 'filler-' || g, 'Filler ' || g, 'landmark',
            30 + (g % 100) / 10.0, 130 + (g % 100) / 10.0, 'seed'
     FROM generate_series(0, $1::int) AS g`,
    [FILLER_PLACES - 1],
  );
  await pool.query(
    `INSERT INTO location_aliases (alias, alias_normalized, location_id, priority)
     SELECT 'filler place ' || g, 'filler place ' || g, 'filler-' || g, 1
     FROM generate_series(0, $1::int) AS g`,
    [FILLER_PLACES - 1],
  );
  await pool.query("ANALYZE locations");
  await pool.query("ANALYZE location_aliases");
}

async function run(statement: { text: string; values: readonly (string | number)[] }): Promise<void> {
  await pool.query(statement.text, [...statement.values]);
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  await truncateCatalogPool(pool);
  await pool.query("TRUNCATE location_aliases, locations RESTART IDENTITY CASCADE");
  await seed();
  capture = await capturePlan(planeDatabaseUrl());
}, 120_000);

afterAll(async () => {
  await capture.close();
  await pool.end();
});

databaseDescribe("bangumi-points: the joined points read (#1629)", () => {
  it("returns the work's points in scene order, dropping nulls to the end", async () => {
    const rows = await bangumiPoints(capture.prisma).pointsForBangumi(CHIHAYAFURU.workId);
    expect(rows.map((row) => row.id)).toEqual(["p-b", "p-a", "p-c", "p-null"]);
  });

  it("carries the joined title and the projected column shape", async () => {
    const rows = await bangumiPoints(capture.prisma).pointsForBangumi(CHIHAYAFURU.workId);
    const first = rows[0];
    expect(first).toMatchObject({
      id: "p-b", name: "B", name_cn: null, bangumi_id: CHIHAYAFURU.workId,
      episode: 1, time_seconds: 60, image: null,
      latitude: 35.2, longitude: 135.2,
      title: CHIHAYAFURU.title, title_cn: null, cover_url: null,
    });
    // `synced_at` is the work's `bangumi.updated_at`, which the trigger sets.
    expect(typeof first?.synced_at).toBe("string");
  });

  it("issues exactly ONE statement", async () => {
    const before = capture.statements().length;
    await bangumiPoints(capture.prisma).pointsForBangumi(CHIHAYAFURU.workId);
    expect(capture.statements()).toHaveLength(before + 1);
  });

  it("returns an empty list for a work with no points", async () => {
    await expect(bangumiPoints(capture.prisma).pointsForBangumi(EMPTY_WORK.workId)).resolves.toEqual([]);
  });
});

databaseDescribe("overview-points: the two overview reads (#1629)", () => {
  it("returns the work's points in stable id order", async () => {
    const rows = await overviewPointsDb(capture.prisma).pointsForWork(CHIHAYAFURU.workId);
    expect(rows.map((row) => row.id)).toEqual(["p-a", "p-b", "p-c", "p-null"]);
  });

  it("reports a work with points, a work without, and an unknown work", async () => {
    const reader = overviewPointsDb(capture.prisma);
    await expect(reader.pointsForWork(EMPTY_WORK.workId)).resolves.toEqual([]);
    await expect(reader.workExists(EMPTY_WORK.workId)).resolves.toBe(true);
    await expect(reader.workExists("no-such-work")).resolves.toBe(false);
  });
});

databaseDescribe("popular-bangumi: the ranking read (#1629)", () => {
  it("ranks works with points by rating, nulls last, and excludes zero-point works", async () => {
    const rows = await popularBangumiDb(capture.prisma).listPopular(10);
    expect(rows.map((row) => row.id)).toEqual([
      POPULAR_A.workId, POPULAR_NULL_RATING.workId, CHIHAYAFURU.workId,
    ]);
    expect(rows.map((row) => row.rating)).toEqual([9.5, null, null]);
  });

  it("returns the projected shape, coalescing an absent count to zero", async () => {
    const rows = await popularBangumiDb(capture.prisma).listPopular(10);
    expect(rows[0]).toEqual({
      id: POPULAR_A.workId, title: POPULAR_A.title, title_cn: null,
      cover_url: null, city: null, points_count: 5, rating: 9.5,
    });
    // `points_count` is NULL for the empty work, so it is excluded rather than
    // reported as a non-number — the deleted `Number(null)` coercion's outcome.
    expect(rows.map((row) => row.points_count)).not.toContain(null);
  });

  it("honours the limit", async () => {
    const rows = await popularBangumiDb(capture.prisma).listPopular(1);
    expect(rows.map((row) => row.id)).toEqual([POPULAR_A.workId]);
  });
});

databaseDescribe("route-points: the itinerary read (#1629)", () => {
  it("preserves the requested id order and drops unknown ids", async () => {
    const rows = await pointsForRoute(capture.prisma).loadPoints(["p-c", "nope", "p-a"]);
    expect(rows.map((row) => row.id)).toEqual(["p-c", "p-a"]);
  });

  it("maps the joined row onto the contract Point shape", async () => {
    const [point] = await pointsForRoute(capture.prisma).loadPoints(["p-b"]);
    expect(point).toEqual({
      id: "p-b", name: "B", bangumi_id: CHIHAYAFURU.workId, screenshot_url: "",
      latitude: 35.2, longitude: 135.2,
      episode: 1, time_seconds: 60, title: CHIHAYAFURU.title,
    });
  });

  it("asks the database nothing for an empty id list", async () => {
    const before = capture.statements().length;
    await expect(pointsForRoute(capture.prisma).loadPoints([])).resolves.toEqual([]);
    expect(capture.statements()).toHaveLength(before);
  });
});

databaseDescribe("title-alias: the resolver reads (#1629)", () => {
  it("returns the highest-priority alias row per work", async () => {
    const rows = await titleAlias(capture.prisma).worksForAlias("ちはやふる");
    expect(rows).toEqual([
      { bangumi_id: CHIHAYAFURU.workId, priority: 70 },
      { bangumi_id: EMPTY_WORK.workId, priority: 10 },
    ]);
  });

  it("counts each work's points, answering zero rather than null for an empty work", async () => {
    const rows = await titleAlias(capture.prisma).candidatesForWorks([CHIHAYAFURU.workId, EMPTY_WORK.workId]);
    expect(rows.map((row) => [row.bangumi_id, row.points_count])).toEqual([
      [CHIHAYAFURU.workId, 4],
      [EMPTY_WORK.workId, 0],
    ]);
  });

  it("returns no works for an alias nothing matches", async () => {
    await expect(titleAlias(capture.prisma).worksForAlias("no-such-alias")).resolves.toEqual([]);
  });
});

databaseDescribe("neon/gazetteer: the two lookup tiers (#1629)", () => {
  it("returns the exact alias match with its priority", async () => {
    const rows = await new NeonGazetteer(capture.prisma).exact("西宮北口");
    expect(rows).toEqual([{
      id: "nishinomiya", name: "西宮北口", kind: "station",
      latitude: 34.7386, longitude: 135.3485, source: "manual", pref: "兵庫県",
      priority: 50, exact: true,
    }]);
  });

  it("returns one row per place in similarity order, flagged not exact", async () => {
    const rows = await new NeonGazetteer(capture.prisma).fuzzy("西宮北口駅");
    expect(rows.map((row) => [row.id, row.exact])).toEqual([["nishinomiya", false], ["osaka", false]]);
    // Per place, `priority` belongs to the alias that scored it HIGHEST (20),
    // not to the place's highest-priority alias (90).
    expect(rows[0]?.priority).toBe(20);
  });
});

databaseDescribe("neon/gazetteer: the trigram predicate's index (#1629)", () => {
  it("serves the trigram predicate from the GIN index when a seq scan is not an option", async () => {
    await new NeonGazetteer(capture.prisma).fuzzy("西宮北口駅");
    const plan = await capture.explainWithoutSeqScan("array_agg");
    expect(indexNames(plan), JSON.stringify(plan)).toContain("idx_location_aliases_trgm");
  });

  it("loses that index path when the trigram index is dropped (mutation)", async () => {
    await pool.query("DROP INDEX idx_location_aliases_trgm");
    try {
      await new NeonGazetteer(capture.prisma).fuzzy("西宮北口駅");
      const plan = await capture.explainWithoutSeqScan("array_agg");
      const indexes = indexNames(plan);
      expect(indexes, JSON.stringify(plan)).not.toContain("idx_location_aliases_trgm");
      // The access path CHANGES rather than merely losing a name: with no index
      // able to serve `alias_normalized % $1`, the planner drives from
      // `locations` and reads the aliases through their own primary key.
      expect(indexes).toContain("location_aliases_pkey");
    } finally {
      await pool.query(
        `CREATE INDEX "idx_location_aliases_trgm"
           ON "public"."location_aliases" USING gin (alias_normalized gin_trgm_ops)`,
      );
    }
  });
});

databaseDescribe("neon/gazetteer: refusing a value the contract cannot type (#1629)", () => {
  /**
   * The MUTATION for the decode: with the CHECK in place the database cannot
   * hold an illegal kind, so the guard is unobservable. Dropping the CHECK lets
   * one in — and the read must then refuse it rather than hand back a
   * `GeocodeHit` whose `kind` is not a `GeocodeKind`.
   */
  it("refuses an impossible kind the database only holds once its CHECK is dropped", async () => {
    await pool.query("ALTER TABLE locations DROP CONSTRAINT locations_kind_896a2215");
    await pool.query(
      "INSERT INTO locations (id, name, kind, latitude, longitude, source) VALUES ('bogus', 'Moon Base', 'moon-base', 1, 1, 'manual')",
    );
    await pool.query(
      "INSERT INTO location_aliases (alias, alias_normalized, location_id, priority) VALUES ('moon', 'moon', 'bogus', 1)",
    );
    try {
      await expect(new NeonGazetteer(capture.prisma).exact("moon"))
        .rejects.toThrow("gazetteer row kind is not a known place kind");
    } finally {
      await pool.query("DELETE FROM location_aliases WHERE location_id = 'bogus'");
      await pool.query("DELETE FROM locations WHERE id = 'bogus'");
      await pool.query(
        "ALTER TABLE locations ADD CONSTRAINT locations_kind_896a2215 CHECK (kind IN ('station', 'city', 'ward', 'landmark', 'prefecture'))",
      );
    }
  });
});

databaseDescribe("the plane's constraints still refuse what they refused (#1629)", () => {
  it("refuses a direct write to the generated coordinate columns", async () => {
    await expect(pool.query("UPDATE points SET latitude = 1 WHERE id = 'p-a'"))
      .rejects.toThrow(/can only be updated to DEFAULT|generated column/iu);
  });

  it("still enforces the location kind CHECK", async () => {
    await expect(pool.query(
      "INSERT INTO locations (id, name, kind, latitude, longitude, source) VALUES ('bad', 'x', 'moon-base', 1, 1, 'manual')",
    )).rejects.toThrow(/locations_kind/u);
  });
});
