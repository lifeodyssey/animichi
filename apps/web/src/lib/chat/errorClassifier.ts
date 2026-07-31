import { ANON_BUDGET_EXHAUSTED_CODE, ANON_QUOTA_EXHAUSTED_CODE } from "@animichi/contract";
import type { ChatDataPart } from "@animichi/contract";

/**
 * D1-D9 fallback states from spec-chat-page-states.md §D (issue #272 S1.6),
 * plus D10 (the edge rate limiter asked us to slow down) and D11 (the
 * anonymous daily budget is spent) from issue #274 S1.8, and D12 (this
 * visitor's own daily message quota is spent) from issue #282 S1.10.
 */
export type ChatErrorState =
  | "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8" | "D9" | "D10" | "D11" | "D12"
  | "D13" | "D14";

export type ImageSurface = "map" | "scene";

/**
 * Client-observable failure signals. Each variant is a raw observation
 * (HTTP status, aborted stream, watchdog, settled envelope, image error);
 * the classifier owns the mapping onto the nine fallback states.
 */
export type FailureSignal =
  | { readonly kind: "http"; readonly status: number; readonly code?: string }
  | { readonly kind: "stream-abort" }
  | { readonly kind: "timeout" }
  | { readonly kind: "envelope"; readonly part: ChatDataPart }
  | { readonly kind: "image"; readonly surface: ImageSurface };

const ROUTE_MINIMUM_POINTS = 3;
const D1_CODE_MARKERS = ["not_found", "no_bangumi", "invalid_station"];

/** The armed edge gate's retryable rejection (`worker/turnstile.ts`, #447). */
export const TURNSTILE_REQUIRED_CODE = "turnstile_required";

/**
 * The two BYOK 403s (issue #284, Tasks 3/4 — wire literals pinned by the
 * spec's error taxonomy; the contract registry entry lands with those tasks).
 * D13 = an anonymous caller presented a credential (`byok_requires_login`):
 * the journey entry, NOT the D8 session-expired story. D14 = the provider
 * refused the credential (`byok_credential_rejected`): an explicit
 * key-not-accepted state — the turn failed rather than silently falling back
 * to the platform key, and the classifier must say so.
 */
export const BYOK_REQUIRES_LOGIN_CODE = "byok_requires_login";
export const BYOK_CREDENTIAL_REJECTED_CODE = "byok_credential_rejected";

/**
 * The two anonymous-limit wire codes are owned by `@animichi/contract`
 * (`error-registry.ts`), not redeclared here — the classifier is one of three
 * tiers that must agree on the literals. D11 means the *whole* anonymous
 * surface spent its dollar ceiling for the day; D12 means *this* visitor spent
 * their own message allowance while the surface is still open, which is why
 * only D12 locks the composer and offers login as the way to lift the ceiling.
 */
/**
 * Every 403 the edge and container can send, and the state it earns. A bare
 * 403 stays D8; each coded one is a visitor who never had a session to expire:
 * D11 the whole anonymous surface spent its dollar ceiling, D12 this visitor
 * spent their own message allowance, and the Turnstile gate a challenge whose
 * recovery is the widget — when one is on the page ChatPage suppresses the
 * strip entirely, and when it is not, D4's generic retry is the honest
 * fallback, never the login banner.
 */
const FORBIDDEN_STATES: Readonly<Record<string, ChatErrorState>> = {
  [ANON_QUOTA_EXHAUSTED_CODE]: "D12",
  [ANON_BUDGET_EXHAUSTED_CODE]: "D11",
  [TURNSTILE_REQUIRED_CODE]: "D4",
  [BYOK_REQUIRES_LOGIN_CODE]: "D13",
  [BYOK_CREDENTIAL_REJECTED_CODE]: "D14",
};

function classifyForbidden(code: string | undefined): ChatErrorState {
  return (code === undefined ? undefined : FORBIDDEN_STATES[code]) ?? "D8";
}

function classifyHttpStatus(status: number, code: string | undefined): ChatErrorState {
  if (status === 403) return classifyForbidden(code);
  if (status === 401) return "D8";
  if (status === 429) return "D10";
  if (status === 408 || status === 504) return "D5";
  return "D4";
}

function firstErrorCode(part: ChatDataPart): string {
  return part.errors?.[0]?.code ?? "";
}

function classifyFailureCode(code: string): ChatErrorState {
  if (D1_CODE_MARKERS.some((marker) => code.includes(marker))) return "D1";
  if (code.includes("timeout")) return "D5";
  return "D6";
}

/**
 * `clarify` is exempt from the blanket `success === false` rule: the backend's
 * invalid-selection response arrives as a failed clarify envelope whose card
 * already carries the recovery (re-pick a candidate) — classifying it D6 would
 * put `regenerate` behind the retry button and reproduce the same failure.
 */
function isFailedEnvelope(part: ChatDataPart): boolean {
  if (part.intent === "error" || part.intent === "unknown") return true;
  if (part.intent === "clarify") return false;
  return part.success === false;
}

function resultRowCount(part: ChatDataPart): number | undefined {
  const data = part.data;
  const results = data && "results" in data ? data.results : undefined;
  return results?.rows?.length ?? results?.row_count;
}

function routePointCount(part: ChatDataPart): number | undefined {
  const data = part.data;
  const route = data && "route" in data ? data.route : undefined;
  return route?.point_count ?? route?.ordered_points?.length;
}

function classifySearchEnvelope(part: ChatDataPart): ChatErrorState | undefined {
  return resultRowCount(part) === 0 ? "D2" : undefined;
}

function classifyRouteEnvelope(part: ChatDataPart): ChatErrorState | undefined {
  const points = routePointCount(part);
  if (points === undefined || points >= ROUTE_MINIMUM_POINTS) return undefined;
  return points === 0 ? "D2" : "D3";
}

function classifyEnvelope(part: ChatDataPart): ChatErrorState | undefined {
  if (isFailedEnvelope(part)) return classifyFailureCode(firstErrorCode(part));
  const intent = part.intent;
  if (intent === "search_bangumi" || intent === "search_nearby") return classifySearchEnvelope(part);
  if (intent === "plan_route" || intent === "plan_selected" || intent === "plan_multi") {
    return classifyRouteEnvelope(part);
  }
  return undefined;
}

/** Map one failure signal onto its D-state; healthy envelopes return undefined. */
export function classifyFailure(signal: FailureSignal): ChatErrorState | undefined {
  if (signal.kind === "http") return classifyHttpStatus(signal.status, signal.code);
  if (signal.kind === "stream-abort") return "D4";
  if (signal.kind === "timeout") return "D5";
  if (signal.kind === "image") return signal.surface === "map" ? "D7" : "D9";
  return classifyEnvelope(signal.part);
}
