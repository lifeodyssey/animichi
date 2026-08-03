import { resolveAnonymousReadOnly } from "./auth.ts";
import type { Env } from "./env.ts";
import { forwardV1 } from "./forward.ts";

// ── Session migration (issue #273 Task 3) ─────────────────────────
//
// The only route where the edge forwards a trusted X-Anon-Id: it resolves
// (never mints) the caller's `aid` cookie into the header the container
// re-validates.
//
// **The cookie is deliberately NOT retired afterwards (owner ruling, #507 —
// this REVERSES S1.7 rev5 P2-b; see the spec's "Decision reversal" note).**
// Retiring it minted a fresh `anon_<hex>` on the next anonymous turn, which
// reset the per-identity quota — so "exhaust the anonymous quota -> take the
// free magic link -> log out -> a brand-new anonymous allowance" became a loop
// the D12 quota banner itself walks the visitor into. Login-grants-quota is the
// conversion funnel working as intended and stays; the log-out-for-more leg
// converts nobody and teaches visitors not to stay signed in.
//
// rev5's privacy argument does not survive the migration it follows: once the
// UPDATE lands, that anonymous identity owns nothing — every `conversations`
// row is re-pointed at the account — so a shared browser's next visitor
// inherits an EMPTY identity. The only thing carried across is the day's quota
// count, which is precisely the effect being kept. (Clearing cookies or opening
// a private window still resets identity — `mintAnonymousIdentity` uses
// `crypto.randomUUID()` with no device binding. That path is unclosable by
// design and is not what this addresses.)
//
// Keeping the cookie also makes a failed migration recoverable: the anonymous
// identity, and the work it still owns, survive for a later retry.

export const SESSION_MIGRATE_PATH = "/v1/session/migrate";

export async function handleSessionMigrate(
  env: Env,
  request: Request,
  auth: { userId: string; userType: string },
): Promise<Response> {
  const identity = await resolveAnonymousReadOnly(request, env);
  return forwardV1(env, request, auth, identity?.userId ?? null);
}
