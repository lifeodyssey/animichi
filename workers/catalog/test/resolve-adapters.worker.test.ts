import { describe, expect, it } from "vitest";
import type { AliasDb } from "../src/adapters/outbound/title-alias";
import { titleAlias } from "../src/adapters/outbound/title-alias";
import { bangumiTitleSearch } from "../src/adapters/outbound/bangumi-search";
import type { FetchLike } from "../src/ingest/sources";

function aliasDb(responses: Record<string, unknown>[][]):
  { db: AliasDb; calls: () => number } {
  let calls = 0;
  const execute = () => {
    calls += 1;
    return Promise.resolve({ rows: responses.shift() ?? [] });
  };
  return { db: { execute }, calls: () => calls };
}

describe("titleAlias Neon adapter", () => {
  it("groups aliases by work and derives stored candidate enrichment", async () => {
    const { db, calls } = aliasDb([
      [{ bangumi_id: "3302", priority: 40 }],
      [{
        id: "3302", title: "らき☆すた", title_cn: "幸运星",
        cover_url: "cover.jpg", air_date: "2007-04-08", points_count: "2",
      }],
    ]);
    const port = titleAlias(db);

    await expect(port.worksForAlias("lucky star")).resolves.toEqual([
      { bangumi_id: "3302", priority: 40 },
    ]);
    await expect(port.candidatesForWorks(["3302"])).resolves.toEqual([{
      bangumi_id: "3302", title: "らき☆すた", title_cn: "幸运星",
      cover_url: "cover.jpg", year: 2007, points_count: 2,
    }]);
    expect(calls()).toBe(2);
  });

  it("maps an empty alias read to no works", async () => {
    const { db } = aliasDb([[]]);

    await expect(titleAlias(db).worksForAlias("no-such-alias")).resolves.toEqual([]);
  });
});

describe("bangumiTitleSearch upstream-ingest adapter", () => {
  it("returns subjects from the fetcher in relevance order", async () => {
    const port = bangumiTitleSearch({ fetchImpl: response({ data: [{ id: 20, name: "Head" }] }) });

    await expect(port.fetchSubjects("Fate")).resolves.toMatchObject([{ id: "20", name: "Head" }]);
  });

  it("maps a transport failure to the upstream_unavailable sentinel", async () => {
    const port = bangumiTitleSearch({
      fetchImpl: () => Promise.reject(new Error("network down")),
      retry: { attempts: 1 },
    });

    await expect(port.fetchSubjects("outage")).resolves.toBe("upstream_unavailable");
  });

  it("maps a 5xx response to the upstream_unavailable sentinel", async () => {
    const port = bangumiTitleSearch({
      fetchImpl: response(null, 503),
      retry: { attempts: 1 },
    });

    await expect(port.fetchSubjects("outage")).resolves.toBe("upstream_unavailable");
  });

  it("maps malformed upstream JSON to the upstream_unavailable sentinel", async () => {
    const invalidJson: FetchLike = () => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("invalid Bangumi JSON")),
    });
    const port = bangumiTitleSearch({ fetchImpl: invalidJson, retry: { attempts: 1 } });

    await expect(port.fetchSubjects("broken")).resolves.toBe("upstream_unavailable");
  });

  it("builds a port with production defaults when no config is given", () => {
    expect(Object.keys(bangumiTitleSearch())).toEqual(["parseSubject", "fetchSubjects"]);
  });

  it("propagates a non-upstream failure instead of the upstream_unavailable sentinel", async () => {
    const port = bangumiTitleSearch({
      fetchImpl: () => Promise.reject(new Error("inner transport")),
      retry: {
        attempts: 2,
        sleep: () => Promise.reject(new Error("sleeper exploded")),
      },
    });

    await expect(port.fetchSubjects("boom")).rejects.toThrow("sleeper exploded");
  });
});

function response(body: unknown, status = 200): FetchLike {
  return () => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}
