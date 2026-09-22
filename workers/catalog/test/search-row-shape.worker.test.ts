import { describe, expect, it } from "vitest";
import { search, searchDb } from "../src/api/search";
import { countingCatalogPrisma, fakeCatalogPrisma } from "./fakes/fake-catalog-prisma";

/**
 * The `search` output shape over the joined points row.
 *
 * Since #1631 the joined read is a plan over the shared contract, so the row
 * IS the plan's projection and the `Catalog row <key> is not …` narrowing the
 * Drizzle seam needed (`src/lib/rows.ts`, deleted by #1629) is gone rather than
 * ported (§4.2): a value the contract does not allow is refused by the
 * driver's codecs, below this layer, and cannot be reached from here. What
 * remains testable here is the projection's output shape — snapshotted below —
 * and that the read really crosses the Prisma plane.
 */

const JOINED_ROW: Record<string, unknown> = {
  id: "spot-1",
  name: "鷲宮神社",
  name_cn: "鹫宫神社",
  bangumi_id: "1",
  episode: 3,
  time_seconds: 120,
  image: "https://image.anitabi.cn/p1.jpg",
  latitude: 36.1019,
  longitude: 139.6586,
  city: "Kuki",
  title: "らき☆すた",
  title_cn: "幸运星",
  cover_url: "https://image.anitabi.cn/cover1.jpg",
  synced_at: "2026-06-20T00:00:00.000Z",
};

function makeJoinedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...JOINED_ROW, ...overrides };
}

/** The production factory over both seams: the alias lookup and the joined
 * points read answer on the Prisma plane (#1631); the ingest's Drizzle seam is
 * never reached by a read. */
function runSearch(row: Record<string, unknown>) {
  return search(
    searchDb(fakeCatalogPrisma([{ bangumi_id: "1" }], [row])),
    { query: "Lucky Star" },
  );
}

describe("search joined-row output shape", () => {
  it("snapshots a normal joined row", async () => {
    await expect(runSearch(makeJoinedRow())).resolves.toMatchInlineSnapshot(`
      {
        "rows": [
          {
            "bangumi_id": "1",
            "city": "Kuki",
            "cover_url": "https://image.anitabi.cn/cover1.jpg",
            "episode": 3,
            "id": "spot-1",
            "latitude": 36.1019,
            "longitude": 139.6586,
            "name": "鷲宮神社",
            "name_cn": "鹫宫神社",
            "screenshot_url": "https://image.anitabi.cn/p1.jpg",
            "time_seconds": 120,
            "title": "らき☆すた",
            "title_cn": "幸运星",
          },
        ],
        "synced_at": "2026-06-20T00:00:00.000Z",
      }
    `);
  });

  it("reads the joined row on the Prisma plane — the Drizzle seam is never reached", async () => {
    const counter = countingCatalogPrisma([{ bangumi_id: "1" }], [makeJoinedRow()]);

    const result = await search(
      searchDb(counter.query),
      { query: "Lucky Star" },
    );

    expect(counter.statements()).toBe(2);
    expect(result.rows.map((row) => row.id)).toEqual(["spot-1"]);
  });
});
