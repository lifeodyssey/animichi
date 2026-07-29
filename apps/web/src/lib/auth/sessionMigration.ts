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
 *    `HttpOnly`, worker-signed cookie (`worker/auth.ts:228`), unreadable from
 *    JS by construction. `credentials: "include"` is therefore the whole
 *    mechanism: the browser attaches `aid`, the edge resolves (never mints) it
 *    and forwards the result as a trusted `X-Anon-Id` on this route alone.
 *
 * That is also why the base URL is `currentChatConfig().baseUrl` rather than a
 * URL of its own — it is the exact origin `/v1/chat` posts to, i.e. the origin
 * whose cookie jar holds `aid`. A migration aimed anywhere else would carry no
 * anonymous identity and quietly migrate nothing.
 */
export const SESSION_MIGRATE_PATH = "/v1/session/migrate";

/**
 * `ok` covers **both** documented successes: `{"migrated": true}` and the typed
 * no-op `{"migrated": false}` (that identity owned nothing, or the caller was
 * never anonymous here). Neither is a failure, and the client has nothing to do
 * differently for either, so they are not distinguished — an unread third value
 * would be dead scaffolding.
 */
export type SessionMigrationOutcome = "ok" | "failed";

async function post(url: string, token: string): Promise<SessionMigrationOutcome> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.ok ? "ok" : "failed";
}

/**
 * Claim this browser's anonymous work for the just-authenticated user.
 *
 * Idempotent by construction on the server side, twice over — which is what
 * makes a repeated magic-link tap or a callback-page refresh harmless:
 *  1. the mutation is `UPDATE ... WHERE user_id = $from_anon`, never `INSERT`,
 *     so a second run matches zero rows and returns `{"migrated": false}`
 *     (`SessionRepository.migrate_ownership`);
 *  2. the first success makes the edge retire the `aid` cookie, so the second
 *     call arrives with no anonymous identity at all and short-circuits before
 *     touching the database (`migrate_session_ownership`'s `None` branch).
 *
 * Total: a rejected `fetch` (offline, DNS, CORS) is an outcome, not a throw.
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
 * Structured, credential-free record of a migration that did not land.
 *
 * Deliberately the same shape as the edge's own `logInvalidCredential`
 * (`worker/app.ts`): a single-key JSON `event` line, no token, no identity.
 * This is the "not blocking, but not silent" half of the failure policy — see
 * `useAuthCallback`'s `runMigration` for why it is not surfaced to the visitor.
 */
export function reportMigrationFailure(): void {
  console.warn(JSON.stringify({ event: "auth_session_migration_failed" }));
}
