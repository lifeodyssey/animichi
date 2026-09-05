import type { TransitEstimate } from "./estimate";

function stationLabel(name: string): string {
  return name.endsWith("駅") ? name : `${name}駅`;
}

export function formatTransitSummary(estimate: TransitEstimate): string {
  const board = stationLabel(estimate.board_station_name);
  const alight = stationLabel(estimate.alight_station_name);
  return `${board}→${alight}:${estimate.line_names.join("→")},約${String(estimate.total_minutes)}分・乗換${String(estimate.transfers)}回`;
}
