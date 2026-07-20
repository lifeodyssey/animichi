import type { ChatDataPart } from "@seichijunrei/contract";

/** D1-D9 fallback states from spec-chat-page-states.md §D (issue #272 S1.6). */
export type ChatErrorState = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8" | "D9";

export type ImageSurface = "map" | "scene";

/**
 * Client-observable failure signals. Each variant is a raw observation
 * (HTTP status, aborted stream, watchdog, settled envelope, image error);
 * the classifier owns the mapping onto the nine fallback states.
 */
export type FailureSignal =
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "stream-abort" }
  | { readonly kind: "timeout" }
  | { readonly kind: "envelope"; readonly part: ChatDataPart }
  | { readonly kind: "image"; readonly surface: ImageSurface };

const ROUTE_MINIMUM_POINTS = 3;
const D1_CODE_MARKERS = ["not_found", "no_bangumi", "invalid_station"];

function classifyHttpStatus(status: number): ChatErrorState {
  if (status === 401 || status === 403) return "D8";
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

/** Map one failure signal onto its D1-D9 state; healthy envelopes return undefined. */
export function classifyFailure(signal: FailureSignal): ChatErrorState | undefined {
  if (signal.kind === "http") return classifyHttpStatus(signal.status);
  if (signal.kind === "stream-abort") return "D4";
  if (signal.kind === "timeout") return "D5";
  if (signal.kind === "image") return signal.surface === "map" ? "D7" : "D9";
  return classifyEnvelope(signal.part);
}
