// ---------------------------------------------------------------------------
// Barrel export — all types available from @/lib/types
// ---------------------------------------------------------------------------

export type {
  Intent,
  PilgrimagePoint,
  NearbyGroup,
  ResultsMeta,
  SearchResultData,
  RouteData,
  LocationCluster,
  TimedStop,
  TransitLeg,
  TimedItinerary,
  QAData,
  ClarifyData,
  ClarifyCandidate,
  TimedRouteData,
} from "./domain";

export type {
  RuntimeRequest,
  PublicAPIError,
  StepEvent,
  RouteHistoryRecord,
  ConversationRecord,
  UIDescriptor,
  RuntimeResponse,
} from "./api";

export type { ErrorCode, ChatMessage } from "./components";

export type { AnimichiMetadata, AnimichiMessage } from "./chat";

// ── Type guards ────────────────────────────────────────────────────────────

import type { RuntimeResponse } from "./api";
import type {
  SearchResultData,
  RouteData,
  QAData,
  ClarifyData,
  TimedRouteData,
} from "./domain";

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function isSearchData(data: RuntimeResponse["data"]): data is SearchResultData {
  return isObjectRecord(data) && isObjectRecord(data.results) && !("route" in data);
}

export function isRouteData(data: RuntimeResponse["data"]): data is RouteData {
  return isObjectRecord(data) && isObjectRecord(data.route);
}

export function isQAData(data: RuntimeResponse["data"]): data is QAData {
  return isObjectRecord(data) && (data.status === "info" || data.status === "needs_clarification");
}

export function isClarifyData(data: RuntimeResponse["data"]): data is ClarifyData {
  return (
    isObjectRecord(data) &&
    typeof data.reason === "string" &&
    Array.isArray(data.candidates) &&
    typeof data.clarification_id === "number"
  );
}

export function isTimedRouteData(data: RuntimeResponse["data"]): data is TimedRouteData {
  if (!isObjectRecord(data) || !isObjectRecord(data.route)) return false;
  return isObjectRecord(data.route.timed_itinerary);
}
