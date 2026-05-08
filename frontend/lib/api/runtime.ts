import type {
  RuntimeRequest,
  RuntimeResponse,
} from "../types";
import { RUNTIME_URL, getAuthHeaders } from "./client";

const SELECTED_ROUTE_ACTION_TEXT = {
  ja: {
    withOrigin: "{origin}から選択した{count}件のスポットでルートを作成して。",
    withoutOrigin: "選択した{count}件のスポットでルートを作成して。",
  },
  zh: {
    withOrigin: "请从{origin}出发，为我规划这{count}个已选取景地的路线。",
    withoutOrigin: "请为我规划这{count}个已选取景地的路线。",
  },
  en: {
    withOrigin: "Create a route with {count} selected stops from {origin}.",
    withoutOrigin: "Create a route with {count} selected stops.",
  },
} as const;

export function buildSelectedRouteActionText(
  pointCount: number,
  origin?: string | null,
  locale: RuntimeRequest["locale"] = "ja",
): string {
  const templates = SELECTED_ROUTE_ACTION_TEXT[locale ?? "ja"];
  const normalizedOrigin = origin?.trim();
  const template = normalizedOrigin
    ? templates.withOrigin
    : templates.withoutOrigin;

  return template
    .replace("{count}", String(pointCount))
    .replace("{origin}", normalizedOrigin ?? "");
}

/**
 * Send a user message to the backend runtime and return the typed response.
 * Throws on HTTP errors so the caller can handle display.
 */
export async function sendMessage(
  text: string,
  sessionId?: string | null,
  locale?: RuntimeRequest["locale"],
  signal?: AbortSignal,
  coords?: { origin_lat: number; origin_lng: number } | null,
): Promise<RuntimeResponse> {
  const body: RuntimeRequest = { text };
  if (sessionId) body.session_id = sessionId;
  if (locale) body.locale = locale;
  if (coords) {
    body.origin_lat = coords.origin_lat;
    body.origin_lng = coords.origin_lng;
  }

  const res = await fetch(`${RUNTIME_URL}/v1/runtime`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(
      errBody?.error?.message ?? `Runtime error (${res.status})`,
    );
  }

  return res.json() as Promise<RuntimeResponse>;
}

export async function sendSelectedRoute(
  pointIds: string[],
  origin?: string | null,
  sessionId?: string | null,
  locale?: RuntimeRequest["locale"],
  signal?: AbortSignal,
): Promise<RuntimeResponse> {
  const normalizedOrigin = origin?.trim();
  const effectiveLocale = locale ?? "ja";
  const body: RuntimeRequest = {
    text: buildSelectedRouteActionText(pointIds.length, normalizedOrigin, effectiveLocale),
    locale: effectiveLocale,
    selected_point_ids: pointIds,
  };
  if (sessionId) body.session_id = sessionId;
  if (normalizedOrigin) body.origin = normalizedOrigin;

  const res = await fetch(`${RUNTIME_URL}/v1/runtime`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(
      errBody?.error?.message ?? `Runtime error (${res.status})`,
    );
  }

  return res.json() as Promise<RuntimeResponse>;
}
