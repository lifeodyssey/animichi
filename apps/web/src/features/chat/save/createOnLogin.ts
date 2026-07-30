import type { SaveRouteInput } from "@animichi/contract";
import { saveRouteRequest } from "../../../api/hooks/use-save-route";
import type { SaveRouteRequest } from "../../../api/hooks/use-save-route";
import { takeDeferredSave, writeDeferredSave } from "./deferredSave";

/**
 * Create-on-login (OQ-9 ruling (b)): the post-login replay creates a **fresh**
 * route from the client-held point ids. There is no claim call and no route id,
 * so `ROUTE_NOT_OWNED` is structurally unreachable on this path.
 */
export function toSaveInput(intent: Readonly<{ pointIds: readonly string[]; title: string }>): SaveRouteInput {
  return { title: intent.title, point_ids: [...intent.pointIds], status: "saved" };
}

/**
 * `none` — the login was not initiated by a save tap, so there was nothing to
 * replay. `failed` is distinct from it precisely so the auth callback can
 * surface a failure instead of reporting a clean login and leaving a live
 * intent to fire, unannounced, on the next login inside the TTL.
 */
export type DeferredReplayOutcome = "none" | "saved" | "failed";

/**
 * Replay only after `takeDeferredSave` has removed the live intent. A blocked
 * claim sends no request; a failed request restores the original intent and
 * timestamp so it can be retried without extending the TTL.
 */
export async function replayDeferredSave(
  request: SaveRouteRequest = saveRouteRequest,
  now: number = Date.now(),
): Promise<DeferredReplayOutcome> {
  const intent = takeDeferredSave(now);
  if (intent === undefined) return "none";
  const saved = await request(toSaveInput(intent)).then(() => true, () => false);
  // A failure restores the entry with its ORIGINAL timestamp, so a retry never
  // silently extends the TTL.
  if (!saved) writeDeferredSave(intent, intent.createdAt);
  return saved ? "saved" : "failed";
}
