/** The nearby-points fixture (#1628): the works, points and detail columns the
 * nearby integration files seed on the Prisma-plane database, so the endpoint
 * assertions, the runtime-lifetime counters and the plan reads all measure the
 * SAME rows. Named for what it builds, per
 * `.claude/rules/naming-ownership.md`. */
import type pg from "pg";
import { pointInsert, pointSeed, workInsert, workSeed, type SeedStatement } from "./fixtures/catalog-seed";

const LUCKY_STAR = workSeed("3701", "らき☆すた");
const GIRLS_UND_PANZER = workSeed("7724", "ガールズ&パンツァー");

/** The four seeded points. `oarai` is ~82 km away — outside `MAX_RADIUS_M`, so
 * it proves the radius clamp rather than an FK gap. */
const NEARBY_POINTS = [
  pointSeed("washinomiya", LUCKY_STAR, "鷲宮神社", 36.1019, 139.6586),
  pointSeed("satte", LUCKY_STAR, "幸手権現堂", 36.0833, 139.725),
  pointSeed("kawagoe", LUCKY_STAR, "川越駅", 35.9077, 139.4828),
  pointSeed("oarai", GIRLS_UND_PANZER, "大洗磯前神社", 36.3142, 140.5876),
];

/** The origin every nearby assertion measures from. */
export const WASHINOMIYA_ORIGIN = { lat: 36.1019, lng: 139.6586 };

/** The detail columns the geo read omits, seeded on `washinomiya`. */
export const WASHINOMIYA_DETAILS = {
  image: "https://img/washinomiya.jpg",
  episode: 1,
  time_seconds: 12,
  origin: "anitabi",
  origin_url: "https://anitabi.cn/washinomiya",
  city: "Kuki",
};

/** Insert this fixture on `pool`: the works, the points, then the details. */
export async function seedNearbyPoints(pool: pg.Pool): Promise<void> {
  for (const statement of nearbySeedStatements()) {
    await pool.query(statement.text, statement.values);
  }
}

/** The fixture's statements in FK order. */
function nearbySeedStatements(): readonly SeedStatement[] {
  return [workInsert([LUCKY_STAR, GIRLS_UND_PANZER]), pointInsert(NEARBY_POINTS), washinomiyaDetails()];
}

/** The detail columns, written onto the fixture's `washinomiya` row. */
function washinomiyaDetails(): SeedStatement {
  return {
    text: "UPDATE points SET image = $1, episode = $2, time_seconds = $3, origin = $4, origin_url = $5, city = $6"
      + " WHERE id = $7",
    values: [
      WASHINOMIYA_DETAILS.image, WASHINOMIYA_DETAILS.episode, WASHINOMIYA_DETAILS.time_seconds,
      WASHINOMIYA_DETAILS.origin, WASHINOMIYA_DETAILS.origin_url, WASHINOMIYA_DETAILS.city, "washinomiya",
    ],
  };
}
