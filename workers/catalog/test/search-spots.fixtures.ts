/** The search + spots fixture (#1631): the works, alias rows and point columns
 * the plane-backed integration file seeds on the Prisma-plane database, so the
 * row-shape assertions and the frozen Drizzle oracle read the SAME rows. Named
 * for what it builds, per `.claude/rules/naming-ownership.md`. */
import type pg from "pg";
import {
  aliasInsert,
  aliasSeed,
  pointInsert,
  pointSeed,
  workInsert,
  workSeed,
  type AliasSeed,
  type SeedStatement,
} from "./fixtures/catalog-seed";

/** The work the contested alias resolves to. */
export const RESOLVED_WORK = workSeed("9253", "らき☆すた");
/** A second work carrying the SAME alias at a lower priority. */
export const SHADOWED_WORK = workSeed("7100", "らき☆すた 別作品");
/** A work with no points at all: `spots` must refuse it. */
export const EMPTY_WORK = workSeed("999999", "点のない作品");

/** The one alias both works carry. `normalizeAlias` is the identity on this
 * string (NFKC-stable, no case or whitespace to fold), so the fixture states
 * the stored key literally instead of borrowing the production normalizer. */
export const CONTESTED_ALIAS = "らき☆すた";

/**
 * Scene order is `(episode ASC, time_seconds ASC, id ASC)`, and the LOWEST id
 * here (`p-01`) is the LAST scene — so `search`'s published order and `spots`'
 * representative pick are two different answers, and neither assertion can pass
 * by reading the other's row.
 */
const RESOLVED_POINTS = [
  pointSeed("p-01", RESOLVED_WORK, "最終話の聖地", 36.1019, 139.6586),
  pointSeed("p-02", RESOLVED_WORK, "二番目の聖地", 36.1025, 139.659),
  pointSeed("p-03", RESOLVED_WORK, "最初の聖地", 36.1031, 139.6594),
];

/** Every scene position, which `pointInsert` does not write. */
const SCENE_POSITIONS = [
  { id: "p-01", episode: 12, time_seconds: 30 },
  { id: "p-02", episode: 1, time_seconds: 120 },
  { id: "p-03", episode: 1, time_seconds: 60 },
];

/** The optional columns `spots` and `search` surface, on the representative
 * point — the one whose id is lowest, not the one whose scene is first. */
const REPRESENTATIVE_DETAILS = {
  id: "p-01",
  image: "https://img/p-01.jpg",
  origin: "anitabi",
  origin_url: "https://anitabi.cn/p-01",
  city: "Kuki",
};

/** Insert this fixture on `pool`: the works, the points, then the columns
 * `pointInsert` does not write. */
export async function seedSearchSpots(pool: pg.Pool): Promise<void> {
  for (const statement of searchSpotsSeedStatements()) {
    await pool.query(statement.text, statement.values);
  }
}

/** The fixture's statements in FK order. */
function searchSpotsSeedStatements(): readonly SeedStatement[] {
  return [
    workInsert([RESOLVED_WORK, SHADOWED_WORK, EMPTY_WORK]),
    pointInsert(RESOLVED_POINTS),
    ...SCENE_POSITIONS.map(scenePosition),
    representativeDetails(),
    aliasInsert(contestedAliases()),
  ];
}

/**
 * The two rows the lookup has to choose between, LOW priority first: heap order
 * would hand back the shadowed work, so only `ORDER BY priority DESC` returns
 * `RESOLVED_WORK`. A plan that drops the ordering fails on this fixture rather
 * than passing by luck.
 */
function contestedAliases(): AliasSeed[] {
  return [
    aliasSeed(SHADOWED_WORK, CONTESTED_ALIAS, CONTESTED_ALIAS, "moegirl", 20),
    aliasSeed(RESOLVED_WORK, CONTESTED_ALIAS, CONTESTED_ALIAS, "bangumi", 40),
  ];
}

/** One point's scene position. */
function scenePosition(position: { id: string; episode: number; time_seconds: number }): SeedStatement {
  return {
    text: "UPDATE points SET episode = $1, time_seconds = $2 WHERE id = $3",
    values: [position.episode, position.time_seconds, position.id],
  };
}

/** The representative point's optional columns. */
function representativeDetails(): SeedStatement {
  return {
    text: "UPDATE points SET image = $1, origin = $2, origin_url = $3, city = $4 WHERE id = $5",
    values: [
      REPRESENTATIVE_DETAILS.image, REPRESENTATIVE_DETAILS.origin,
      REPRESENTATIVE_DETAILS.origin_url, REPRESENTATIVE_DETAILS.city,
      REPRESENTATIVE_DETAILS.id,
    ],
  };
}
