/**
 * Anitabi display contract: attribution, licence, image size, and identity.
 *
 * Import-free so `workers/edge` can read it at runtime without pulling zod
 * (#1285). Keep it that way — `test/import-free-modules.test.ts` holds it.
 *
 * Landmark screenshots are CC BY-NC-SA 4.0. The upstream docs require the
 * `origin` text beside a displayed screenshot and `originURL` link navigation.
 * Image URLs must carry an explicit size plan; omitting `plan` is a full-
 * resolution request, which those docs advise against for public display.
 */

/** Credit text shown beside a landmark screenshot. */
export const ANITABI_ATTRIBUTION = "Anitabi";

/** The licence the Anitabi location data is published under. */
export const ANITABI_LICENSE_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";

/** One User-Agent for every request we make to this upstream. */
export const ANITABI_USER_AGENT =
  "Animichi/1.0 (https://github.com/lifeodyssey/animichi)";

/** Documented thumbnail height. List and grid surfaces ask for this. */
export const ANITABI_THUMBNAIL_PLAN = "h160";

/** Documented mobile / detail height. Full resolution is not a public plan. */
export const ANITABI_MOBILE_PLAN = "h360";

/** Size plans Anitabi documents for public display. */
export type AnitabiImagePlan =
  | typeof ANITABI_THUMBNAIL_PLAN
  | typeof ANITABI_MOBILE_PLAN;

/** The documented plan, or `null` when the request would be full-resolution. */
export function parseAnitabiImagePlan(raw: string | null | undefined): AnitabiImagePlan | null {
  if (raw === ANITABI_THUMBNAIL_PLAN || raw === ANITABI_MOBILE_PLAN) return raw;
  return null;
}

/** Attach an explicit size plan. The type forbids omitting it. */
export function withAnitabiImagePlan(url: string, plan: AnitabiImagePlan): string {
  return url.startsWith("/") ? relativeWithPlan(url, plan) : absoluteWithPlan(url, plan);
}

function relativeWithPlan(path: string, plan: AnitabiImagePlan): string {
  const parsed = new URL(path, "https://animichi.invalid");
  parsed.searchParams.set("plan", plan);
  return `${parsed.pathname}${parsed.search}`;
}

function absoluteWithPlan(url: string, plan: AnitabiImagePlan): string {
  const parsed = new URL(url);
  parsed.searchParams.set("plan", plan);
  return parsed.toString();
}
