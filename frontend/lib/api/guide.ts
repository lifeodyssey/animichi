import type { PilgrimagePoint } from "../types/domain";
import { RUNTIME_URL } from "./client";

export interface AnimeGuideResponse {
  bangumi_id: string;
  title: string;
  title_cn: string | null;
  cover_url: string | null;
  city: string | null;
  spot_count: number;
  spots: PilgrimagePoint[];
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
}

/**
 * Fetch the full anime pilgrimage guide — all spots, no auth.
 */
export async function fetchAnimeGuide(
  bangumiId: string,
  locale?: string,
  signal?: AbortSignal,
): Promise<AnimeGuideResponse | null> {
  const url = locale
    ? `${RUNTIME_URL}/v1/bangumi/${bangumiId}/guide?locale=${encodeURIComponent(locale)}`
    : `${RUNTIME_URL}/v1/bangumi/${bangumiId}/guide`;
  const res = await fetch(url, {
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Guide fetch failed (${res.status})`);
  return res.json() as Promise<AnimeGuideResponse>;
}
