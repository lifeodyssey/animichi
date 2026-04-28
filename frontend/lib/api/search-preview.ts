import type { PilgrimagePoint } from "../types/domain";
import { RUNTIME_URL } from "./client";

export interface SearchPreviewResponse {
  results: {
    rows: PilgrimagePoint[];
    row_count: number;
    total_available: number;
    preview_limit: number;
    status: "ok" | "empty";
    metadata?: {
      anime_title?: string;
      anime_title_cn?: string;
      cover_url?: string | null;
      bangumi_id?: string;
    };
  };
  auth_required_for_full: boolean;
  message: string;
}

/**
 * Anonymous search preview — no auth required.
 * Returns up to 5 pilgrimage points matching the query.
 */
export async function fetchSearchPreview(
  query: string,
  locale: "ja" | "zh" | "en" = "ja",
  signal?: AbortSignal,
): Promise<SearchPreviewResponse> {
  const params = new URLSearchParams({ q: query, locale });
  const res = await fetch(`${RUNTIME_URL}/v1/search/preview?${params}`, {
    signal,
  });

  if (!res.ok) {
    if (res.status === 404) {
      return {
        results: {
          rows: [],
          row_count: 0,
          total_available: 0,
          preview_limit: 5,
          status: "empty",
        },
        auth_required_for_full: false,
        message: "",
      };
    }
    throw new Error(`Search preview failed (${res.status})`);
  }

  return res.json() as Promise<SearchPreviewResponse>;
}
