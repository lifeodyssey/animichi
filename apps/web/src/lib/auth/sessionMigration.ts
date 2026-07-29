import { currentChatConfig } from "../../features/chat/config";

/**
 * Anonymous -> signed-in session ownership migration (issue #273 Task 3, #507).
 *
 * The endpoint is **identity-dimensional**: no body and no `session_id` — the
 * magic-link tab has none, and accepting one would re-introduce an
 * ownership-probing surface. The two identities it needs arrive on trusted
 * channels only:
 *
 *  - the incoming real user, from the `Authorization` bearer the edge verifies;
 *  - the outgoing `anon_<hex>`, which the client **cannot** name. `aid` is an
 *    `HttpOnly`, worker-signed cookie (`worker/auth.ts`), unreadable from JS by
 *    construction. `credentials: "include"` is therefore the whole mechanism:
 *    the browser attaches `aid`, the edge resolves (never mints) it and
 *    forwards the result as a trusted `X-Anon-Id` on this route alone.
 *
 * That is also why the base URL is `currentChatConfig().baseUrl` rather than a
 * URL of its own — it is the exact origin `/v1/chat` posts to, i.e. the origin
 * whose cookie jar holds `aid`. A migration aimed anywhere else would carry no
 * anonymous identity and quietly migrate nothing.
 */
export const SESSION_MIGRATE_PATH = "/v1/session/migrate";

/**
 * The endpoint's two documented successes are kept **distinct** (#507 review
 * P1-2). Folding `{"migrated": false}` into a generic success hid the one case
 * the client can actually detect: a magic link opened on a different device
 * carries the session in its `next` target but none of this browser's `aid`
 * cookie, so the migration correctly moves nothing — indistinguishable, once
 * collapsed, from a visitor who simply had no anonymous history. That mismatch
 * is also the only signal that would catch a *re-broken* wiring, which is the
 * exact failure mode #507 was.
 */
export type SessionMigrationOutcome = "migrated" | "nothing" | "failed";

/**
 * Mobile-first budget (#507 review P2). 8s was inherited from the deferred-save
 * replay, but this runs on a Capacitor webview on transit Wi-Fi as often as on
 * a desktop, and a single `UPDATE` behind one edge hop has no business taking
 * longer. `keepalive` lets the request outlive a callback screen the visitor
 * navigates away from, so a slow network degrades to "the server still gets it"
 * rather than "the mutation is cancelled mid-flight".
 */
export const MIGRATE_TIMEOUT_MS = 4_000;

function request(token: string): RequestInit {
  return {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { Authorization: `Bearer ${token}` },
  };
}

async function post(url: string, token: string): Promise<SessionMigrationOutcome> {
  const response = await fetch(url, request(token));
  if (!response.ok) return "failed";
  const body: unknown = await response.json();
  return (body as { migrated?: unknown }).migrated === true ? "migrated" : "nothing";
}

/**
 * Claim this browser's anonymous work for the just-authenticated user.
 *
 * Idempotent by construction on the server: the mutation is
 * `UPDATE … WHERE user_id = $from_anon`, never `INSERT`, so a second run
 * matches zero rows and returns `{"migrated": false}` — which makes a repeated
 * magic-link tap, a callback refresh and a retry all harmless. The #507 owner
 * ruling additionally stopped the edge retiring the `aid` cookie — which
 * matters for exactly one failure branch, the client-timeout-but-server-
 * succeeded race, since retirement was already gated on `didMigrate` and every
 * other failure left the cookie standing.
 *
 * Total: a rejected `fetch` (offline, DNS, CORS) or an unparseable body is an
 * outcome, not a throw.
 */
export function migrateAnonymousSession(
  token: string,
  baseUrl: string = currentChatConfig().baseUrl,
): Promise<SessionMigrationOutcome> {
  return post(`${baseUrl}${SESSION_MIGRATE_PATH}`, token).catch(
    (): SessionMigrationOutcome => "failed",
  );
}

/**
 * Why a migration did not land. `failed` is a request that did not succeed;
 * `nothing-migrated` is a 200 that moved no rows when the login demonstrably
 * came from a browser with a session — the cross-device case, and the tell that
 * the wiring has broken again.
 */
export type MigrationAnomaly = "failed" | "nothing-migrated";

/**
 * Did this outcome fail the visitor? `expected` says the login's return target
 * named a chat session, so *some* row should have moved.
 */
export function anomalyOf(
  outcome: SessionMigrationOutcome,
  expected: boolean,
): MigrationAnomaly | undefined {
  if (outcome === "failed") return "failed";
  if (outcome === "nothing" && expected) return "nothing-migrated";
  return undefined;
}

/**
 * Structured, credential-free record. Deliberately **not** the reporting
 * channel: `apps/web` has no telemetry sink, so a `console.warn` reaches the
 * visitor's own devtools and nobody else (#507 review P1-3). The real outlet is
 * the callback screen's migration-failure surface, which puts a retry in front
 * of the one party who can act on it; this line is a developer aid beside it.
 */
export function reportMigrationAnomaly(anomaly: MigrationAnomaly): void {
  console.warn(JSON.stringify({ event: "auth_session_migration", anomaly }));
}
