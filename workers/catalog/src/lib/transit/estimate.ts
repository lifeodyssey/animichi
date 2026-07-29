import { EXPECTED_WAIT_MIN, TRANSFER_PENALTY_MIN, WALK_DETOUR_COEFFICIENT, WALKING_SPEED_M_PER_MIN } from "./constants";
import { shortestPathBetweenGroups, type TransitPath } from "./dijkstra";
import type { TransitIndex } from "./graph";
import { nearestStation, type NearestStation } from "./nearest";

export interface Coordinate { lat: number; lng: number }
export interface TransitEstimate {
  board_station_name: string;
  alight_station_name: string;
  line_names: string[];
  transfers: number;
  rail_minutes: number;
  wait_minutes: number;
  access_walk_minutes: number;
  egress_walk_minutes: number;
  total_minutes: number;
  distance_m: number;
}

function walkMinutes(distanceM: number): number {
  return distanceM * WALK_DETOUR_COEFFICIENT / WALKING_SPEED_M_PER_MIN;
}

function lineNames(path: TransitPath, index: TransitIndex): string[] {
  const names = path.rail_edges.map((edge) => index.lines.get(edge.line_id)?.name ?? edge.line_id);
  return names.filter((name, index_) => index_ === 0 || name !== names[index_ - 1]);
}

function endpoint(path: TransitPath, index: TransitIndex, first: boolean): string {
  const id = first ? path.station_ids.at(0) : path.station_ids.at(-1);
  if (!id) throw new Error("Transit path has no stations");
  return index.stations.get(id)?.name ?? id;
}

function totalMinutes(path: TransitPath, access: number, egress: number): number {
  const waits = EXPECTED_WAIT_MIN * (path.transfers + 1);
  return Math.round(path.rail_minutes + waits + path.transfers * TRANSFER_PENALTY_MIN + access + egress);
}

function assemble(path: TransitPath, index: TransitIndex, board: NearestStation, alight: NearestStation): TransitEstimate {
  const access = walkMinutes(board.distance_m);
  const egress = walkMinutes(alight.distance_m);
  return { board_station_name: endpoint(path, index, true), alight_station_name: endpoint(path, index, false), line_names: lineNames(path, index), transfers: path.transfers, rail_minutes: path.rail_minutes, wait_minutes: EXPECTED_WAIT_MIN * (path.transfers + 1), access_walk_minutes: access, egress_walk_minutes: egress, total_minutes: totalMinutes(path, access, egress), distance_m: Math.round((path.rail_distance_m + board.distance_m + alight.distance_m) * 10) / 10 };
}

export function estimateTransitLeg(from: Coordinate, to: Coordinate, index: TransitIndex): TransitEstimate | null {
  const board = nearestStation(from.lat, from.lng, index.stations.values());
  const alight = nearestStation(to.lat, to.lng, index.stations.values());
  if (!board || !alight || board.station.group_id === alight.station.group_id) return null;
  const path = shortestPathBetweenGroups(index, board.station.group_id, alight.station.group_id);
  return path ? assemble(path, index, board, alight) : null;
}
