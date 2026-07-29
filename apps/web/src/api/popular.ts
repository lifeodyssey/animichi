import { z } from "zod";
import { resolveOrigin } from "./config";

/**
 * Popular-ranking payload for `GET /v1/bangumi/popular`.
 *
 * This agent-side endpoint predates the oRPC contract (spec S5.5 keeps it as
 * an existing public route), so the shape is mirrored here rather than in
 * `packages/contract`. Numeric ids/counts are coerced from the raw DB rows.
 */
export const PopularBangumi = z.object({
  id: z.coerce.string(),
  title: z.string(),
  title_cn: z.string().nullish(),
  cover_url: z.string().nullish(),
  city: z.string().nullish(),
  points_count: z.coerce.number().default(0),
  rating: z.coerce.number().nullish(),
});
export type PopularBangumi = z.infer<typeof PopularBangumi>;

export const PopularResult = z.object({ bangumi: z.array(PopularBangumi) });
export type PopularResult = z.infer<typeof PopularResult>;

function browserLocation(): { readonly origin: string } | undefined {
  return typeof window === "undefined" ? undefined : window.location;
}

export function popularUrl(limit: number): string {
  const origin = resolveOrigin(import.meta.env, browserLocation());
  return `${origin}/v1/bangumi/popular?limit=${String(limit)}`;
}

export async function fetchPopular(limit = 8): Promise<PopularResult> {
  const response = await fetch(popularUrl(limit), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`popular request failed: ${String(response.status)}`);
  return PopularResult.parse(await response.json());
}
