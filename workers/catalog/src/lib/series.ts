/**
 * Series-aware graph walker over `series_edges`.
 *
 * Backs series-aware resolve ("is X part of the same series as Y") per
 * `docs/superpowers/specs/2026-04-27-series-aware-resolve-design.md` (Mode C,
 * lines 81-84): candidates linked by a Bangumi relation of
 * 续集 / 前传 / 番外篇 / 总集篇 / 相同世界观 count as the SAME series; a 'character'
 * (角色) or any unrelated relation does NOT merge components.
 *
 * Pure graph logic — no I/O, no DB. The DB read of `series_edges` is a thin
 * separate wrapper layered on top of `walkSeries`.
 */

/**
 * Bangumi v0 relation kinds we model (`/v0/subjects/{id}/subjects` `.relation`).
 * The same-series subset is enumerated in {@link SAME_SERIES_RELATIONS}; every
 * other value (e.g. `character`) is treated as a non-series edge and ignored
 * by {@link walkSeries}.
 */
export type Relation =
  | "sequel"
  | "prequel"
  | "side_story"
  | "summary"
  | "same_setting"
  | "character"
  | "other";

/** A directed edge from the `series_edges` table (from_work_id, to_work_id, relation). */
export interface SeriesEdge {
  fromWorkId: string;
  toWorkId: string;
  relation: Relation;
}

/**
 * Relations that count as "same series" per the design doc:
 * 续集 (sequel), 前传 (prequel), 番外篇 (side_story), 总集篇 (summary),
 * 相同世界观 (same_setting). Excludes 角色 (character) and unrelated edges.
 */
export const SAME_SERIES_RELATIONS: ReadonlySet<Relation> = new Set<Relation>([
  "sequel",
  "prequel",
  "side_story",
  "summary",
  "same_setting",
]);

/** Index same-series edges as an undirected adjacency map (forward + reverse). */
function buildAdjacency(edges: SeriesEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (SAME_SERIES_RELATIONS.has(edge.relation)) {
      link(adj, edge.fromWorkId, edge.toWorkId);
      link(adj, edge.toWorkId, edge.fromWorkId);
    }
  }
  return adj;
}

/** Add a single directed neighbour entry to the adjacency map. */
function link(adj: Map<string, Set<string>>, from: string, to: string): void {
  const bucket = adj.get(from);
  if (bucket) {
    bucket.add(to);
  } else {
    adj.set(from, new Set([to]));
  }
}

/**
 * BFS over same-series edges (treated as bidirectional), returning every
 * work_id in the connected series component containing `startWorkId`
 * (inclusive). A visited set makes it cycle-safe.
 */
export function walkSeries(edges: SeriesEdge[], startWorkId: string): Set<string> {
  const adj = buildAdjacency(edges);
  const visited = new Set<string>([startWorkId]);
  let frontier = [startWorkId];
  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const current of frontier) visit(adj.get(current), visited, nextFrontier);
    frontier = nextFrontier;
  }
  return visited;
}

/** Enqueue any unvisited neighbours of the current node. */
function visit(
  neighbours: Set<string> | undefined,
  visited: Set<string>,
  queue: string[],
): void {
  for (const next of neighbours ?? []) {
    if (!visited.has(next)) {
      visited.add(next);
      queue.push(next);
    }
  }
}
