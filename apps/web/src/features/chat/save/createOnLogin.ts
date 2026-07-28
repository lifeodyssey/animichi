import type { SaveRouteInput } from "@seichijunrei/contract";
import { saveRouteRequest } from "../../../api/hooks/use-save-route";
import type { SaveRouteRequest } from "../../../api/hooks/use-save-route";
import { clearDeferredSave, readDeferredSave, writeDeferredSave } from "./deferredSave";
import type { DeferredSaveIntent } from "./deferredSave";

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
 * Replay the deferred save exactly once after a login. A login that was **not**
 * initiated by a save tap finds no intent and issues no request. The entry is
 * claimed (deleted) before the request goes out so two tabs cannot both save it,
 * and restored on failure — so a failed replay is never silently dropped.
 */
/** Claim before sending: two tabs completing a login concurrently would
 * otherwise both read the same intent and create two rows. The loser finds
 * nothing. */
function claimDeferredSave(now: number): DeferredSaveIntent | undefined {
  const intent = readDeferredSave(now);
  if (intent !== undefined) clearDeferredSave();
  return intent;
}

export async function replayDeferredSave(
  request: SaveRouteRequest = saveRouteRequest,
  now: number = Date.now(),
): Promise<DeferredReplayOutcome> {
  const intent = claimDeferredSave(now);
  if (intent === undefined) return "none";
  const saved = await request(toSaveInput(intent)).then(() => true, () => false);
  // A failure restores the entry with its ORIGINAL timestamp, so a retry never
  // silently extends the TTL.
  if (!saved) writeDeferredSave(intent, intent.createdAt);
  return saved ? "saved" : "failed";
}
