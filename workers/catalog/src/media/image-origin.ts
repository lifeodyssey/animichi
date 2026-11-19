/**
 * The URL a point photo is pulled from (`./img.ts`), built on the Anitabi image
 * origin with an explicit size plan.
 *
 * The image origin is the Image API base of the pinned upstream document,
 * `https://image.anitabi.cn` (`docs/api-reference/anitabi-api.md`). A stored
 * image names it in one of two forms: a leading-slash path, or an absolute
 * `http:` or `https:` URL on exactly that host, with no port and no userinfo.
 * `../enrich/parse.ts` expands Anitabi's leading-slash paths at enrich time, so
 * the second form is the usual one. Either form keeps its path and query, drops
 * its fragment, and is rebuilt on the https origin. Any other stored value names
 * no URL to pull, and the caller refuses it.
 */
import { withAnitabiImagePlan, type AnitabiImagePlan } from "@animichi/contract/anitabi-display";

const IMAGE_ORIGIN = "https://image.anitabi.cn";
const IMAGE_HOST = new URL(IMAGE_ORIGIN).hostname;

/**
 * The URL a stored image is pulled from, or `null` when it is not on the image
 * origin. A leading-slash path is joined to the origin as text, so `//x` and
 * `/\x` stay paths there.
 */
export function originPullUrl(stored: string, plan: AnitabiImagePlan): string | null {
  const url = URL.parse(stored.startsWith("/") ? `${IMAGE_ORIGIN}${stored}` : stored);
  if (url === null || !onImageOrigin(url)) return null;
  return withAnitabiImagePlan(`${IMAGE_ORIGIN}${url.pathname}${url.search}`, plan);
}

/** An `http:` or `https:` URL on exactly the image host, with no port and no userinfo. */
function onImageOrigin(url: URL): boolean {
  const web = url.protocol === "https:" || url.protocol === "http:";
  return web && url.hostname === IMAGE_HOST && url.port === "" && url.username === "" && url.password === "";
}
