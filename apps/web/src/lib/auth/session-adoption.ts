import { resolveAgentBaseUrl } from "../../api/config";
import { currentRuntimeConfig } from "../runtime-config/provider";

/**
 * Anonymous -> signed-in session ownership adoption (SESSION-2 #960).
 *
 * The endpoint is **identity-dimensional**: no body and no `session_id` — the
 * magic-link tab has none, and accepting one would re-introduce an
 * ownership-probing surface. The two identities it needs arrive on trusted
 * channels only:
 *
 *  - the incoming real user, from the `Authorization` bearer the edge verifies;
 *  - the outgoing `anon_<hex>`, which the client **cannot** name. `aid` is an
 *    `HttpOnly`, worker-signed cookie (`workers/edge/identity/auth.ts`),
 *    unreadable from JS by construction. `credentials: "include"` is therefore
 *    the whole mechanism: the browser attaches `aid`, and the edge resolves
 *    (never mints) it in-process for this route alone — #1601 moved adoption
 *    into the Worker, so the identity is consumed where it is resolved rather
 *    than forwarded as `X-Anon-Id` to a container.
 *
 * That is also why the base URL is the agent origin resolved by
 * `resolveAgentBaseUrl` rather than a URL of its own — it is the exact origin
 * `/v1/chat` posts to, i.e. the origin whose cookie jar holds `aid`. An
 * adoption aimed anywhere else would carry no anonymous identity and quietly
 * adopt nothing.
 */
export const SESSION_ADOPT_PATH = "/v1/sessions/adopt";

/**
 * The endpoint's two documented successes are kept **distinct** (#507 review
 * P1-2). Folding `{"adopted": 0}` into a generic success hid the one case the
 * client can actually detect: a magic link opened on a different device
 * carries the session in its `next` target but none of this browser's `aid`
 * cookie, so the adoption correctly moves nothing — indistinguishable, once
 * collapsed, from a visitor who simply had no anonymous history. That mismatch
 * is also the only signal that would catch a *re-broken* wiring, which is the
 * exact failure mode #507 was.
 */
export type SessionAdoptionOutcome = "adopted" | "nothing" | "failed";

/**
 * Mobile-first budget (#507 review P2). 8s was inherited from the deferred-save
 * replay, but this runs on a Capacitor webview on transit Wi-Fi as often as on
 * a desktop, and a single `UPDATE` behind one edge hop has no business taking
 * longer.
 *
 * `keepalive` is a narrower guarantee than it may read as (#514 review round 2):
 * an in-SPA navigation never interrupts a `fetch` anyway, so it buys nothing
 * there. It matters for **document unload** — the visitor closing the tab or
 * following a link away while the claim is still in flight. Cheap, and the
 * request carries no body, so the 64KB keepalive ceiling is not in play.
 */
export const ADOPT_TIMEOUT_MS = 4_000;

function request(token: string): RequestInit {
  return {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { Authorization: `Bearer ${token}` },
  };
}

/** `adopted` must be a non-negative integer for the response to be trusted
 * (SESSION-2 #960): a missing, string, or negative value is an invalid Agent
 * or Edge response, never a silent ownership transfer. */
function adoptedOutcome(body: unknown): SessionAdoptionOutcome {
  if (typeof body !== "object" || body === null) return "failed";
  const adopted = (body as { adopted?: unknown }).adopted;
  if (typeof adopted !== "number" || !Number.isInteger(adopted) || adopted < 0) return "failed";
  return adopted === 0 ? "nothing" : "adopted";
}

async function post(url: string, token: string): Promise<SessionAdoptionOutcome> {
  const response = await fetch(url, request(token));
  if (!response.ok) return "failed";
  return adoptedOutcome(await response.json());
}

function defaultAdoptBaseUrl(): string {
  return resolveAgentBaseUrl(
    currentRuntimeConfig().api,
    typeof window === "undefined" ? undefined : window.location,
  );
}

/**
 * Claim this browser's anonymous work for the just-authenticated user.
 *
 * Idempotent by construction on the server: the mutation is
 * `UPDATE … WHERE user_id = $from_anon`, never `INSERT`, so a second run
 * matches zero rows and returns `{"adopted": 0}` — which makes a repeated
 * magic-link tap, a callback refresh and a retry all harmless. The #507 owner
 * ruling additionally stopped the edge retiring the `aid` cookie — which
 * matters for exactly one failure branch, the client-timeout-but-server-
 * succeeded race, since retirement was already gated on `didMigrate` and every
 * other failure left the cookie standing.
 *
 * Total: a rejected `fetch` (offline, DNS, CORS) or an unparseable body is an
 * outcome, not a throw.
 */
export function adoptSessions(
  token: string,
  baseUrl: string = defaultAdoptBaseUrl(),
): Promise<SessionAdoptionOutcome> {
  return post(`${baseUrl}${SESSION_ADOPT_PATH}`, token).catch((): SessionAdoptionOutcome => "failed");
}

/**
 * Why an adoption did not land. `failed` is a request that did not succeed;
 * `nothing-adopted` is a 200 that moved no rows when the login demonstrably
 * came from a browser with a session — the cross-device case, and the tell
 * that the wiring has broken again.
 */
export type AdoptionAnomaly = "failed" | "nothing-adopted";

/**
 * Did this outcome fail the visitor? `expected` says the login's return target
 * named a chat session, so *some* row should have moved. `afterTimeout`
 * rescues the one false negative the timeout race produces (SESSION-2 #960):
 * when an earlier attempt timed out the server may still have landed it, so a
 * later `"nothing"` is the retry observing that adoption rather than a genuine
 * no-op — and the notice must clear.
 */
export function anomalyOf(
  outcome: SessionAdoptionOutcome,
  expected: boolean,
  afterTimeout = false,
): AdoptionAnomaly | undefined {
  if (outcome === "failed") return "failed";
  if (outcome === "nothing" && expected && !afterTimeout) return "nothing-adopted";
  return undefined;
}

/** One adoption attempt's timeout memory, shared across the initial run and
 * every retry (SESSION-2 #960): a timed-out attempt's outcome is unknown, so a
 * later `"nothing"` may be observing the server landing the earlier one — and
 * must not be flagged as a no-op anomaly. */
export interface AdoptionTimeline {
  timedOut: boolean;
}

/** Runs `run` under a `ms` timeout, reporting whether the timeout fired so the
 * caller can remember an unknown outcome (SESSION-2 #960). `async` on purpose:
 * a *synchronous* throw from `run` becomes a rejection that `.catch` folds
 * into `onTimeout` — it never rejects the caller. */
async function timedRace<T>(
  run: () => Promise<T>, ms: number, onTimeout: T,
): Promise<{ value: T; timedOut: boolean }> {
  let timedOut = false;
  const value = await Promise.race([
    Promise.resolve().then(run).catch((): T => onTimeout),
    new Promise<T>((resolve) => { setTimeout(() => { timedOut = true; resolve(onTimeout); }, ms); }),
  ]);
  return { value, timedOut };
}

/**
 * One adoption attempt: the adopt call under the mobile-first timeout, the
 * outcome judged against `expected` and the timeline's memory. Structurally
 * incapable of rejecting (#507 review P2) — it rides a `Promise.all` beside
 * the deferred-save replay, so a throw here would reject the whole redeem and
 * report a *successful* login as `"error"`. `adoptSessions` already catches,
 * but relying on a collaborator's internals for that is the fragile version —
 * this makes it a property of the call site, and a throwing-adopt test pins
 * it.
 *
 * A timeout is recorded as `failed` (and remembered in `timeline`). The race
 * does not abort the request, so the server may still succeed afterwards and
 * this becomes a false negative. This is **the one** case the #507 owner
 * ruling actually rescues: under the old edge the server's success would have
 * retired the `aid` cookie, leaving the retry with no identity to present.
 * Every other failure branch already kept its cookie — retirement was gated on
 * success — so "keeping the cookie makes failures recoverable" is true for
 * this timing race and not in general. Either way the retry is the same
 * idempotent `UPDATE`; the remembered timeout lets that retry recognise a
 * late-landed success as success (SESSION-2 #960).
 *
 * The anomaly is **returned, not reported**: the report belongs where the
 * outcome meets a live screen, so an abandoned mount (#1760) cannot emit
 * `auth_session_adoption` with nobody home.
 */
export async function runAdoption(
  adopt: (token: string) => Promise<SessionAdoptionOutcome>,
  token: string, expected: boolean, timeline: AdoptionTimeline,
): Promise<AdoptionAnomaly | undefined> {
  const priorTimeout = timeline.timedOut;
  const { value: outcome, timedOut } = await timedRace(() => adopt(token), ADOPT_TIMEOUT_MS, "failed");
  timeline.timedOut ||= timedOut;
  return anomalyOf(outcome, expected, priorTimeout);
}

/**
 * Structured, credential-free record. Deliberately **not** the reporting
 * channel: `apps/web` has no telemetry sink, so a `console.warn` reaches the
 * visitor's own devtools and nobody else (#507 review P1-3). The real outlet is
 * the callback screen's adoption-failure surface, which puts a retry in front
 * of the one party who can act on it; this line is a developer aid beside it.
 */
export function reportAdoptionAnomaly(anomaly: AdoptionAnomaly): void {
  console.warn(JSON.stringify({ event: "auth_session_adoption", anomaly }));
}
