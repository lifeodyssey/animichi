import type { ChatDataPart } from "@animichi/contract";
import { routeOf } from "../components/cards";
import type { SpotRow } from "../components/cards";
import type { ChatDict } from "../i18n";
import { saveRouteTitle } from "../route-copy";

/** Everything create-on-login needs from a rendered route card. */
export interface SaveTarget {
  readonly pointIds: readonly string[];
  readonly title: string;
}

/** Streamed routes carry points either as bare ids or as objects. */
function idOf(point: string | SpotRow): string | undefined {
  const id = typeof point === "string" ? point : point.id;
  return id !== undefined && id !== "" ? id : undefined;
}

function pointIdsOf(points: readonly (string | SpotRow)[]): readonly string[] {
  return points.map(idOf).filter((id): id is string => id !== undefined);
}

/**
 * The save payload for one route card, or `undefined` when there is nothing to
 * save yet — which is exactly what keeps the CTA disabled and unable to open
 * the login wall.
 */
export function routeSaveTarget(part: ChatDataPart, dict: ChatDict): SaveTarget | undefined {
  const route = routeOf(part);
  const pointIds = pointIdsOf(route?.ordered_points ?? []);
  if (pointIds.length === 0) return undefined;
  return { pointIds, title: saveRouteTitle(dict, route?.anime_title, pointIds.length) };
}
