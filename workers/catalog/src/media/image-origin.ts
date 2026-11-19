/**
 * The URL a point photo is pulled from (`./img.ts`): the stored image on the
 * Anitabi image origin, with an explicit size plan.
 *
 * `points.image` is usually a full URL already (`../enrich/parse.ts` expands
 * Anitabi's leading-slash paths to image.anitabi.cn at enrich time); a stored
 * leading-slash path is expanded here too.
 */
import { withAnitabiImagePlan, type AnitabiImagePlan } from "@animichi/contract/anitabi-display";

const IMAGE_BASE = "https://image.anitabi.cn";

/** The origin URL a public display path may fetch: an explicit size plan is required. */
export function originPullUrl(stored: string, plan: AnitabiImagePlan): string {
  const expanded = stored.startsWith("/") ? `${IMAGE_BASE}${stored}` : stored;
  return withAnitabiImagePlan(expanded, plan);
}
