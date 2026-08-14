import { describe, expect, it } from "vitest";
import { NeonGazetteer } from "../src/adapters/outbound/neon/gazetteer";
import { FUZZY_RESULT_LIMIT, FUZZY_SIMILARITY_THRESHOLD } from "../src/domain/geocode/collapse";
import { fakeDb, hit, queryParams } from "./geocode-doubles";

/**
 * Behavioural coverage for the gazetteer adapter (Spec Testing Decisions +
 * STORY 24 — no rendered-SQL assertions). The adapter is a thin pass-through
 * over the single `db.execute` seam: the SQL semantics (alias-normalized
 * equality, DISTINCT ON dedupe, trigram fold, sim-desc ordering) live in the
 * built statement and the database. The DB is therefore the oracle here: we
 * script the rows a real query would return (deduped + ranked) and assert the
 * adapter echoes them; the only SQL data we inspect is the bound-parameter
 * list (term / trigram threshold / result limit), never the rendered text.
 */
describe("catalog gazetteer adapter — exact tier", () => {
  it("returns the exact-alias rows the database matched, unchanged", async () => {
    const expected = hit({ exact: true });
    await expect(new NeonGazetteer(fakeDb([expected])).exact("西宮")).resolves.toEqual([expected]);
  });

  it("matches only the normalized alias with no fuzzy fold", async () => {
    const db = fakeDb([hit({})]);
    await new NeonGazetteer(db).exact("西宮");
    expect(db.executeSpy).toHaveBeenCalledTimes(1);
    // One bound parameter: the alias equality term. No `%` operator, no
    // similarity, no threshold or limit — i.e. nothing of the fuzzy tier.
    expect(queryParams(db.executeSpy.mock.calls[0]?.[0])).toEqual(["西宮"]);
  });
});

describe("catalog gazetteer adapter — fuzzy tier", () => {
  it("returns fuzzy rows in DB ranking order (no adapter re-sort)", async () => {
    const first = hit({ id: "seed:a", exact: false });
    const second = hit({ id: "seed:b", exact: false });
    const db = fakeDb([first, second]);
    const rows = await new NeonGazetteer(db).fuzzy("西宮北口");
    // The DB ranks (DISTINCT ON per location, ordered by similarity desc);
    // the adapter must hand those rows through un-ordered.
    expect(rows).toEqual([first, second]);
  });

  it("flags fuzzy rows as not exact", async () => {
    const db = fakeDb([hit({ exact: false })]);
    expect((await new NeonGazetteer(db).fuzzy("西宮北口"))[0]?.exact).toBe(false);
  });

  it("drives the strict trigram threshold and result limit via bound params", async () => {
    const db = fakeDb([], []);
    await new NeonGazetteer(db).fuzzy("西宮北口");
    const params = queryParams(db.executeSpy.mock.calls[0]?.[0]);
    // trigram pre-filter + similarity bind the term, then the strict
    // threshold and the result cap are the final params.
    expect(params).toContain("西宮北口");
    expect(params).toContain(FUZZY_SIMILARITY_THRESHOLD);
    expect(params[params.length - 1]).toBe(FUZZY_RESULT_LIMIT);
  });

  it("pins the strict similarity threshold and result limit", () => {
    expect(FUZZY_SIMILARITY_THRESHOLD).toBe(0.4);
    expect(FUZZY_RESULT_LIMIT).toBe(10);
  });
});
