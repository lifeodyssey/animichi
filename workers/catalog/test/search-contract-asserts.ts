import { expect } from "vitest";
import { ORPCError } from "@orpc/server";
import { search } from "../src/api/search";
import type { PublishedPointRow } from "../src/application/list-points-for-bangumi";
import { fakeDb, ROW } from "./in-memory-search-db";

export async function searchError(run: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(ORPCError);
    return err as ORPCError<string, unknown>;
  }
  throw new Error("expected search to reject");
}

export async function assertContractShape(): Promise<void> {
  const { db } = fakeDb({ "lucky star": { workId: "1", rows: [ROW] } });
  const result = await search(db, { query: "Lucky Star" });
  expect(result.rows).toHaveLength(1);
  expect(result.partial).toBeUndefined();
  expect(result.rows[0]).toEqual(contractRow());
}

function contractRow() {
  return {
    id: "spot-1", name: "鷲宮神社", name_cn: "鹫宫神社", bangumi_id: "1",
    episode: 3, time_seconds: 120, screenshot_url: "https://image.anitabi.cn/p1.jpg",
    latitude: 36.1019, longitude: 139.6586, title: "らき☆すた", title_cn: "幸运星",
    cover_url: "https://image.anitabi.cn/cover1.jpg",
    city: "Kuki",
  };
}

export async function assertNullFieldsOmitted(): Promise<void> {
  const { db } = fakeDb({ "lucky star": { workId: "1", rows: [bareRow()] } });
  const result = await search(db, { query: "lucky star" });
  expect(result.rows[0]).toEqual(minimalRow());
}

function bareRow(): PublishedPointRow {
  return {
    ...ROW, name_cn: null, episode: null, time_seconds: null,
    image: null, title: null, title_cn: null, cover_url: null, city: null, synced_at: null,
  };
}

function minimalRow() {
  return {
    id: "spot-1", name: "鷲宮神社", bangumi_id: "1",
    screenshot_url: "", latitude: 36.1019, longitude: 139.6586,
  };
}
