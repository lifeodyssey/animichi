import type { TransitEdge, TransitIndex } from "./graph";
import { compareStrings } from "./compare";
import { MinHeap } from "./heap";

export interface TransitRailEdge { from: string; to: string; line_id: string }
export interface TransitPath {
  station_ids: string[];
  rail_edges: TransitRailEdge[];
  transfers: number;
  rail_minutes: number;
  rail_distance_m: number;
}

interface QueueEntry { stationId: string; distance: number }
interface Previous { stationId: string; edge: TransitEdge }

function seed(sources: readonly string[], distances: Map<string, number>, heap: MinHeap<QueueEntry>): void {
  for (const stationId of [...sources].sort(compareStrings)) { distances.set(stationId, 0); heap.push({ stationId, distance: 0 }, 0, stationId); }
}

function relax(from: string, edge: TransitEdge, distance: number, distances: Map<string, number>, previous: Map<string, Previous>, heap: MinHeap<QueueEntry>): void {
  const candidate = distance + edge.minutes;
  if (candidate >= (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) return;
  distances.set(edge.to, candidate);
  previous.set(edge.to, { stationId: from, edge });
  heap.push({ stationId: edge.to, distance: candidate }, candidate, edge.to);
}

function trace(target: string, previous: Map<string, Previous>): Previous[] {
  const steps: Previous[] = [];
  let cursor = target;
  while (previous.has(cursor)) { const step = previous.get(cursor); if (!step) break; steps.push(step); cursor = step.stationId; }
  return steps.reverse();
}

function toPath(target: string, steps: Previous[]): TransitPath {
  const first = steps.at(0);
  const station_ids = first ? [first.stationId, ...steps.map((step) => step.edge.to)] : [target];
  const rail = steps.filter((step) => step.edge.kind === "rail");
  return { station_ids, rail_edges: rail.map(toRailEdge), transfers: steps.length - rail.length, rail_minutes: rail.reduce((sum, step) => sum + step.edge.minutes, 0), rail_distance_m: rail.reduce((sum, step) => sum + step.edge.distance_m, 0) };
}

function toRailEdge(step: Previous): TransitRailEdge {
  if (!step.edge.line_id) throw new Error("Rail edge is missing line_id");
  return { from: step.stationId, to: step.edge.to, line_id: step.edge.line_id };
}

function search(index: TransitIndex, sources: readonly string[], targets: ReadonlySet<string>): TransitPath | null {
  const heap = new MinHeap<QueueEntry>();
  const distances = new Map<string, number>();
  const previous = new Map<string, Previous>();
  seed(sources, distances, heap);
  while (heap.size) { const item = heap.pop(); if (!item) break; if (item.distance !== distances.get(item.stationId)) continue; if (targets.has(item.stationId)) return toPath(item.stationId, trace(item.stationId, previous)); for (const edge of index.adjacency.get(item.stationId) ?? []) relax(item.stationId, edge, item.distance, distances, previous, heap); }
  return null;
}

export function shortestPath(index: TransitIndex, fromStationId: string, toStationId: string): TransitPath | null {
  if (!index.stations.has(fromStationId) || !index.stations.has(toStationId)) return null;
  return search(index, [fromStationId], new Set([toStationId]));
}

export function shortestPathBetweenGroups(index: TransitIndex, fromGroupId: string, toGroupId: string): TransitPath | null {
  const sources = index.groups.get(fromGroupId) ?? [];
  const targets = new Set(index.groups.get(toGroupId) ?? []);
  return sources.length && targets.size ? search(index, sources, targets) : null;
}
