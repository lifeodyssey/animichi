import { describe, expect, it } from "vitest";
import { search, searchDb } from "../src/api/search";
import { catalogDb } from "./in-memory-search-db";
import { fakeCatalogPrisma } from "./fakes/fake-catalog-prisma";

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

/** The production factory over both seams: the alias lookup answers one hit on
 * the Prisma plane (#1631), the joined points read on the Drizzle seam. */
function runSearch(row: Record<string, unknown>) {
  return search(searchDb(fakeCatalogPrisma([{ bangumi_id: "1" }]), catalogDb([row])), { query: "Lucky Star" });
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

  it("rejects an invalid numeric field at the joined-row boundary", async () => {
    await expect(runSearch(makeJoinedRow({ latitude: "not-a-number" })))
      .rejects.toThrow("Catalog row latitude is not numeric");
  });

  it("rejects a null required numeric field instead of coercing to 0", async () => {
    await expect(runSearch(makeJoinedRow({ latitude: null })))
      .rejects.toThrow("Catalog row latitude is not numeric");
  });

  it("rejects an empty-string required numeric field instead of coercing to 0", async () => {
    await expect(runSearch(makeJoinedRow({ longitude: "" })))
      .rejects.toThrow("Catalog row longitude is not numeric");
  });
});
