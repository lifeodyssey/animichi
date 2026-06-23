import { describe, expect, it } from "vitest";
import {
  SAME_SERIES_RELATIONS,
  walkSeries,
  type SeriesEdge,
} from "../src/lib/series";

/**
 * Graph-walker tests for series-aware resolve.
 *
 * Same-series relations (续集/前传/番外篇/总集篇/相同世界观) merge into one
 * connected component; non-series relations (角色 = 'character') do NOT.
 * Source: docs/superpowers/specs/2026-04-27-series-aware-resolve-design.md
 * (Mode C, lines 81-84). Pure logic — named *.worker.test.ts so the existing
 * vitest-pool-workers config picks it up; no Docker, no DB.
 */

const SEQUEL_CHAIN: SeriesEdge[] = [
  { fromWorkId: "A", toWorkId: "B", relation: "sequel" },
  { fromWorkId: "B", toWorkId: "C", relation: "sequel" },
];

function assertExcludesCharacter(): void {
  const edges: SeriesEdge[] = [
    { fromWorkId: "A", toWorkId: "B", relation: "sequel" },
    { fromWorkId: "B", toWorkId: "C", relation: "character" },
  ];
  expect([...walkSeries(edges, "A")].sort()).toEqual(["A", "B"]);
  expect(walkSeries(edges, "A").has("C")).toBe(false);
}

function assertSameSeriesRelations(): void {
  expect([...SAME_SERIES_RELATIONS].sort()).toEqual([
    "prequel", "same_setting", "sequel", "side_story", "summary",
  ]);
  expect(SAME_SERIES_RELATIONS.has("character")).toBe(false);
}

describe("walkSeries (series.ts)", () => {
  it("returns just the start node when there are no edges", () => {
    expect([...walkSeries([], "A")]).toEqual(["A"]);
  });

  it("walks a linear sequel chain A->B->C into one component", () => {
    expect([...walkSeries(SEQUEL_CHAIN, "A")].sort()).toEqual(["A", "B", "C"]);
  });

  it("traverses edges in reverse: starting from C reaches A", () => {
    // C has no outgoing edge; only reverse traversal reaches B then A.
    expect([...walkSeries(SEQUEL_CHAIN, "C")].sort()).toEqual(["A", "B", "C"]);
  });

  it("is cycle-safe: A->B->A does not loop forever", () => {
    const edges: SeriesEdge[] = [
      { fromWorkId: "A", toWorkId: "B", relation: "sequel" },
      { fromWorkId: "B", toWorkId: "A", relation: "prequel" },
    ];
    expect([...walkSeries(edges, "A")].sort()).toEqual(["A", "B"]);
  });

  it("excludes non-series relations: a 'character' edge does not merge components", assertExcludesCharacter);

  it("merges via side_story / summary / same_setting relations", () => {
    const edges: SeriesEdge[] = [
      { fromWorkId: "A", toWorkId: "B", relation: "side_story" },
      { fromWorkId: "B", toWorkId: "C", relation: "summary" },
      { fromWorkId: "C", toWorkId: "D", relation: "same_setting" },
    ];
    expect([...walkSeries(edges, "A")].sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("SAME_SERIES_RELATIONS is the documented set and excludes character", assertSameSeriesRelations);
});
