/** The one point the wire-shape integration file seeds: a `points` row with
 * every column the read endpoints map set, on a work whose title columns are
 * set too. Named for what it builds, per `.claude/rules/naming-ownership.md`. */
import type pg from "pg";
import { pointInsert, pointSeed, workInsert, workSeed, type SeedStatement } from "./fixtures/catalog-seed";

/** The work, under a Bangumi subject id `points-by-bangumi-id` accepts. */
export const WIRE_WORK = workSeed("3704", "涼宮ハルヒの憂鬱");

/** The point's id and coordinates, which the nearby and itinerary requests name. */
export const WIRE_POINT = { id: "wire-1", name: "県立北高校", latitude: 34.7569, longitude: 135.3466 };

/** The work's title columns that `workInsert` does not write. */
const WORK_TITLES = { title_cn: "凉宫春日的忧郁", cover_url: "https://covers.invalid/3704.jpg" };

/** The point's columns that `pointInsert` does not write. */
const POINT_COLUMNS = {
  name_cn: "县立北高中",
  episode: 1,
  time_seconds: 95,
  image: "https://photos.invalid/3704/wire-1.jpg",
  city: "西宮市",
  origin: "Anitabi",
  origin_url: "https://origin.invalid/points/wire-1",
};

/** Insert the work and the point on `pool`. */
export async function seedWirePoint(pool: pg.Pool): Promise<void> {
  for (const statement of wireSeedStatements()) {
    await pool.query(statement.text, statement.values);
  }
}

/** The fixture's statements in FK order. */
function wireSeedStatements(): readonly SeedStatement[] {
  return [
    workInsert([WIRE_WORK]),
    workTitles(),
    pointInsert([pointSeed(WIRE_POINT.id, WIRE_WORK, WIRE_POINT.name, WIRE_POINT.latitude, WIRE_POINT.longitude)]),
    pointColumns(),
  ];
}

function workTitles(): SeedStatement {
  return {
    text: "UPDATE bangumi SET title_cn = $1, cover_url = $2 WHERE id = $3",
    values: [WORK_TITLES.title_cn, WORK_TITLES.cover_url, WIRE_WORK.workId],
  };
}

function pointColumns(): SeedStatement {
  const columns = POINT_COLUMNS;
  return {
    text: "UPDATE points SET name_cn = $1, episode = $2, time_seconds = $3, image = $4,"
      + " city = $5, origin = $6, origin_url = $7 WHERE id = $8",
    values: [
      columns.name_cn, columns.episode, columns.time_seconds, columns.image,
      columns.city, columns.origin, columns.origin_url, WIRE_POINT.id,
    ],
  };
}
