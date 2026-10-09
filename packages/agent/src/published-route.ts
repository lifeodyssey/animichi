import type { Point } from "@animichi/contract/models";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import { readCommittedEntry } from "./committed-entry.ts";
import { RouteDetails } from "./pilgrimage-projection.ts";

export interface PublishedRoute {
  readonly points: Point[];
  readonly ids: string[];
}

/**
 * The stops a committed `plan_route` result published: its itinerary, but only while the frozen
 * summary a later turn is shown still carries those same ordered ids. A summary that lost them is
 * a stale reference, not a route a subset may be re-planned from.
 */
export async function readPublishedRoute(session: Session, branchName: string, ref: string, context: Context): Promise<PublishedRoute | undefined> {
  const entry = await readCommittedEntry(session, branchName, ref, context);
  if (entry?.type !== "message" || entry.message.role !== "toolResult" || entry.message.isError) return undefined;
  if (entry.message.toolName !== "plan_route") return undefined;
  const details = RouteDetails.safeParse(entry.message.details);
  if (!details.success) return undefined;
  const points = details.data.itinerary.ordered_points;
  if (!publishes(details.data.frozenSummary, points)) return undefined;
  return { points, ids: points.map((point) => point.id) };
}

function publishes(summary: string | undefined, points: readonly Point[]): boolean {
  if (summary === undefined) return true;
  return summary.includes(`ordered_stops=${JSON.stringify(points.map((point) => point.id))}`);
}
