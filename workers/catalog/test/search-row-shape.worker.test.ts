import { describe, expect, it } from "vitest";
import { search, searchDb } from "../src/api/search";
import type { CatalogDb } from "../src/db/client";

const NORMAL_ROW: Record<string, unknown> = {
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

function catalogDb(responses: unknown[][]): CatalogDb {
  const execute = () => Promise.resolve({ rows: responses.shift() ?? [] });
  return { execute } as unknown as CatalogDb;
}

function runSearch(row: Record<string, unknown>) {
  const db = catalogDb([[{ work_id: "1" }], [row]]);
  return search(searchDb(db), { query: "Lucky Star" });
}

describe("search joined-row output shape", () => {
  it("snapshots a normal joined row", async () => {
    await expect(runSearch(NORMAL_ROW)).resolves.toMatchInlineSnapshot(`
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

  it("snapshots the current pass-through of an invalid numeric field", async () => {
    await expect(runSearch({ ...NORMAL_ROW, latitude: "not-a-number" })).resolves.toMatchInlineSnapshot(`
      {
        "rows": [
          {
            "bangumi_id": "1",
            "city": "Kuki",
            "cover_url": "https://image.anitabi.cn/cover1.jpg",
            "episode": 3,
            "id": "spot-1",
            "latitude": "not-a-number",
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
});
