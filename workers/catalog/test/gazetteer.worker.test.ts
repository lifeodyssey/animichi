import { describe, expect, it } from "vitest";
import { NeonGazetteer } from "../src/adapters/outbound/neon/gazetteer";
import { FUZZY_RESULT_LIMIT, FUZZY_SIMILARITY_THRESHOLD } from "../src/domain/geocode/collapse";
import { fakeDb, fuzzySql, hit, sqlText } from "./geocode-doubles";

describe("catalog gazetteer adapter — exact tier", () => {
  it("matches the normalized alias exactly and flags rows as exact", async () => {
    const db = fakeDb([hit({})]);

    await new NeonGazetteer(db).exact("西宮");

    const sql = sqlText(db.executeSpy.mock.calls[0]?.[0]);
    expect(sql).toContain("alias_normalized");
    expect(sql).toContain("TRUE as \"exact\"");
    expect(sql).not.toContain("%");
  });

  it("returns the queried rows as hits unchanged", async () => {
    const expected = hit({ id: "seed:nishinomiya-station" });

    await expect(new NeonGazetteer(fakeDb([expected])).exact("西宮")).resolves.toEqual([expected]);
  });
});

describe("catalog gazetteer adapter — fuzzy tier", () => {
  it("deduplicates aliases per location before applying the fuzzy limit", async () => {
    expect(await fuzzySql()).toContain('distinct on ("locations"."id")');
  });

  it("applies deterministic inner and outer fuzzy tie-breaks", async () => {
    const query = await fuzzySql();
    expect(query).toContain("similarity");
    expect(query.toLowerCase()).toContain("priority");
    expect(query.toLowerCase()).toContain(" desc");
    expect(query).toContain("order by \"sim\" desc");
  });

  it("uses the trigram match operator so the GIN index can serve fuzzy lookup", async () => {
    expect(await fuzzySql()).toContain('"alias_normalized" %');
  });

  it("flags fuzzy rows as not exact and pins the strict threshold", async () => {
    const db = fakeDb([], []);

    await new NeonGazetteer(db).fuzzy("西宮北口");

    expect(sqlText(db.executeSpy.mock.calls[0]?.[0])).toContain("FALSE as \"exact\"");
    expect(FUZZY_SIMILARITY_THRESHOLD).toBe(0.4);
    expect(FUZZY_RESULT_LIMIT).toBe(10);
  });
});
