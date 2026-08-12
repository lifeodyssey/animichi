import type { SaveSavedRouteInput } from "@animichi/contract";
import { saveSavedRouteRequest } from "../../../api/hooks/use-saved-route";
import type { SaveSavedRouteRequest } from "../../../api/hooks/use-saved-route";
import {
  clearDeferredSave,
  pruneDeferredSave,
  takeDeferredSave,
  writeDeferredSave,
} from "./deferred-save";

/**
 * CompleteDeferredSave — the owned seam behind a save that started behind the
 * login wall (#273 S1.7, WEB-1 #958). The save wall (use-save-gate) and the
 * auth callback (use-auth-callback/AuthCallback) both depend on this module;
 * neither reaches into the adapters underneath.
 *
 * Three adapters:
 * - **browser-storage adapter** (deferred-save.ts): the bounded PendingSave
 *   intent in namespaced localStorage — deliberately no `session_id` (the
 *   magic-link tab has none), with the 30-minute TTL, mount prune and
 *   take-before-send consume-once claim.
 * - **Neon-session adapter** (`getAuthToken`/`authHeaders`,
 *   lib/auth/auth-session.ts): the bearer the USERS-1 client attaches to every
 *   request. The replay is authenticated without the seam touching the Neon
 *   Auth origin itself; the auth callback redeems the session cookie into this
 *   cache before the replay runs.
 * - **USERS-1 client adapter** (`saveSavedRouteRequest`,
 *   api/hooks/use-saved-route.ts): the create-fresh SavedRoute call through
 *   the users Worker — the post-login replay creates a new row from the
 *   client-held point ids, never a claim on an existing route.
 */

/**
 * Create-on-login (OQ-9 ruling (b)): the post-login replay creates a **fresh**
 * route from the client-held point ids. There is no claim call and no route id,
 * so `SAVED_ROUTE_NOT_OWNED` is structurally unreachable on this path.
 */
export function toSaveInput(intent: Readonly<{ pointIds: readonly string[]; title: string }>): SaveSavedRouteInput {
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
 * claim reports failure without sending; a failed request restores the original
 * intent and timestamp so it can be retried without extending the TTL.
 */
export async function replayDeferredSave(
  request: SaveSavedRouteRequest = saveSavedRouteRequest,
  now: number = Date.now(),
): Promise<DeferredReplayOutcome> {
  const claim = takeDeferredSave(now);
  if (claim.kind !== "claimed") return claim.kind === "failed" ? "failed" : "none";
  const saved = await request(toSaveInput(claim.intent)).then(() => true, () => false);
  // A failure restores the entry with its ORIGINAL timestamp, so a retry never
  // silently extends the TTL.
  if (!saved) writeDeferredSave(claim.intent, claim.intent.createdAt);
  return saved ? "saved" : "failed";
}

/** The save wall's stash surface: write behind the wall, clear on dismissal
 * (before a send is committed), sweep abandoned intents on mount. */
export { clearDeferredSave, pruneDeferredSave, writeDeferredSave };
