import { describe, expect, it } from "vitest";
import { NeonGazetteer } from "../src/adapters/outbound/neon/gazetteer";
import { FUZZY_RESULT_LIMIT, FUZZY_SIMILARITY_THRESHOLD, type GeocodeHit } from "../src/domain/geocode/collapse";
import { countingCatalogPrisma, fakeCatalogPrisma } from "./fakes/fake-catalog-prisma";

/**
 * Behavioural coverage for the gazetteer adapter (Spec Testing Decisions +
 * STORY 24). The adapter is a thin pass-through over the request's Prisma
 * runtime: the SQL semantics (alias-normalized equality, the per-location
 * pick, the trigram fold, sim-desc ordering) live in the built plan and the
 * database. The DB is therefore the oracle — the integration file seeds a real
 * gazetteer and asserts the rows; here we script the rows a real query would
 * return and assert the adapter hands them through.
 *
 * The rendered-statement and bound-parameter assertions the Drizzle version
 * carried are gone with `db.execute`: the plan is built by the same builder the
 * Worker uses, and the SQL it lowers to is read from the real runtime in
 * `outbound-adapters.integration.test.ts`, not from a fake.
 */

const NISHINOMIYA: GeocodeHit = {
  id: "seed:nishinomiya-station",
  name: "西宮駅",
  kind: "station",
  latitude: 34.7386,
  longitude: 135.3485,
  source: "manual",
  pref: "兵庫県",
  priority: 100,
  exact: true,
};

/** A place row as both plans project it. */
function placeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: NISHINOMIYA.id,
    name: NISHINOMIYA.name,
    kind: NISHINOMIYA.kind,
    latitude: NISHINOMIYA.latitude,
    longitude: NISHINOMIYA.longitude,
    source: NISHINOMIYA.source,
    pref: NISHINOMIYA.pref,
    priority: NISHINOMIYA.priority,
    ...overrides,
  };
}

/** The hit a place row decodes to, at the tier under test. */
function hit(overrides: Partial<GeocodeHit> = {}, exact = true): GeocodeHit {
  return { ...NISHINOMIYA, exact, ...overrides };
}

describe("catalog gazetteer adapter — exact tier", () => {
  it("returns the exact-alias rows the database matched, flagged exact", async () => {
    await expect(new NeonGazetteer(fakeCatalogPrisma([placeRow()])).exact("西宮"))
      .resolves.toEqual([hit()]);
  });

  it("issues the exact tier as ONE statement", async () => {
    const counter = countingCatalogPrisma([placeRow()]);
    await new NeonGazetteer(counter.query).exact("西宮");
    expect(counter.statements()).toBe(1);
  });

  it("returns an empty list when the alias matches nothing", async () => {
    await expect(new NeonGazetteer(fakeCatalogPrisma([])).exact("no-such-place")).resolves.toEqual([]);
  });
});

describe("catalog gazetteer adapter — fuzzy tier", () => {
  it("returns fuzzy rows in DB ranking order (no adapter re-sort)", async () => {
    const first = placeRow({ id: "seed:a", sim: 0.9 });
    const second = placeRow({ id: "seed:b", sim: 0.5 });
    const rows = await new NeonGazetteer(fakeCatalogPrisma([first, second])).fuzzy("西宮北口");
    // The database ranks; the adapter must hand those rows through un-ordered.
    expect(rows.map((row) => row.id)).toEqual(["seed:a", "seed:b"]);
  });

  it("flags fuzzy rows as not exact", async () => {
    const rows = await new NeonGazetteer(fakeCatalogPrisma([placeRow({ sim: 0.9 })])).fuzzy("西宮北口");
    expect(rows[0]?.exact).toBe(false);
  });

  it("issues the fuzzy tier as ONE statement", async () => {
    const counter = countingCatalogPrisma([placeRow({ sim: 0.9 })]);
    await new NeonGazetteer(counter.query).fuzzy("西宮北口");
    expect(counter.statements()).toBe(1);
  });
});

describe("catalog gazetteer adapter — a value the CHECK constraint should forbid", () => {
  it("fails loudly instead of laundering an unknown kind through a cast", async () => {
    const rows = fakeCatalogPrisma([placeRow({ kind: "moon-base" })]);
    await expect(new NeonGazetteer(rows).exact("西宮"))
      .rejects.toThrow("gazetteer row kind is not a known place kind");
  });

  it("fails loudly instead of laundering an unknown source through a cast", async () => {
    const rows = fakeCatalogPrisma([placeRow({ source: "guesswork" })]);
    await expect(new NeonGazetteer(rows).exact("西宮"))
      .rejects.toThrow("gazetteer row source is not a known place source");
  });
});

describe("catalog gazetteer tier constants", () => {
  it("pins the strict similarity threshold and result limit", () => {
    expect(FUZZY_SIMILARITY_THRESHOLD).toBe(0.4);
    expect(FUZZY_RESULT_LIMIT).toBe(10);
  });
});
