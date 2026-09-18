import {
  ANITABI_USER_AGENT,
  parseAnitabiImagePlan,
  withAnitabiImagePlan,
  type AnitabiImagePlan,
} from "@animichi/contract/anitabi-display";
import type { WorkerExecutionContext } from "../env.ts";
import { gatewayRejection } from "../gateway/responses.ts";
import { cacheWrite } from "./cache-write.ts";
import { docsAssetResponse, resolveDocsAsset } from "./docs-assets.ts";
import { IMAGE_CACHE_CONTROL } from "./image-cache-control.ts";
import type { R2ObjectBucket } from "./private-r2-object.ts";

const IMAGE_PREFIX = "/img/";
const ENCODED_SEPARATOR = /%2f|%5c/i;

/** A path the proxy refuses (empty or traversal), in the shared edge envelope
 * (EG-05) rather than the plain text it used to answer. */
function refusedPath(): Response {
  return gatewayRejection("image_path_invalid", 400, "The image path is not one this proxy serves.");
}

function percentDecoded(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/** A path that names a separator or a traversal — what a traversal looks like
 * to the decoder that will read it. A bare `.`/`..` segment is not tested
 * separately: the runtime resolves the dot segments of the request line before
 * this reads it, so a `..` that survives is the substring case here (which is
 * why `/img/a..b.png` is refused), and a lone `.` cannot survive at all. */
function namesTraversal(imagePath: string): boolean {
  if (ENCODED_SEPARATOR.test(imagePath) || imagePath.includes("\\") || imagePath.includes("..")) return true;
  return imagePath.split("/").some((segment) => segment.length === 0);
}

/** The path a source is asked for, or `null` when it is not one a source may be
 * asked for. The origin arm splices this path into a URL, so it has to mean the
 * same thing to the next decoder — ours, an HTTP cache's, or the origin's — as
 * it does here: an escape that could still become a separator or a `..`
 * segment is refused before routing, and a second encoding level with it. The
 * runtime has already resolved the dot segments of the request line itself, so
 * this is the last boundary at which the path is still ours to judge. */
function imagePathOf(request: Request): string | null {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(IMAGE_PREFIX)) return null;
  const imagePath = pathname.slice(IMAGE_PREFIX.length);
  const decoded = percentDecoded(imagePath);
  if (imagePath.length === 0 || decoded === null) return null;
  return namesTraversal(imagePath) || namesTraversal(decoded) || decoded.includes("%") ? null : imagePath;
}

function refusedFullResolution(): Response {
  return gatewayRejection("image_plan_required", 400, "Public image requests must include a documented size plan.");
}

async function fetchImage(imagePath: string, plan: AnitabiImagePlan): Promise<Response> {
  const url = withAnitabiImagePlan(`https://image.anitabi.cn/${imagePath}`, plan);
  return fetch(url, { headers: { "User-Agent": ANITABI_USER_AGENT } });
}

function upstreamError(upstream: Response): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg" },
  });
}

function cacheableResponse(upstream: Response): Response {
  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", IMAGE_CACHE_CONTROL);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.delete("Set-Cookie");
  return new Response(upstream.body, { status: 200, headers });
}

async function imageResponse(imagePath: string, request: Request): Promise<Response> {
  const plan = parseAnitabiImagePlan(new URL(request.url).searchParams.get("plan"));
  if (plan === null) return refusedFullResolution();
  const upstream = await fetchImage(imagePath, plan);
  return upstream.ok ? cacheableResponse(upstream) : upstreamError(upstream);
}

/** Which source owns this path: the private docs-asset bucket, or the Anitabi
 * origin. A path inside the reserved namespace that is not an approved asset is
 * refused here — it is never a reason to consult the origin. */
function sourceResponse(
  request: Request, imagePath: string, docsAssets: R2ObjectBucket | undefined, ctx: WorkerExecutionContext,
): Promise<Response> {
  const docs = resolveDocsAsset(imagePath);
  if (docs.kind === "refused") return Promise.resolve(refusedPath());
  if (docs.kind === "asset") return docsAssetResponse(request, docs.asset, docsAssets, ctx);
  return proxiedImageResponse(request, imagePath, ctx);
}

/** Image proxy + cache. `/img/<path>` is served from one of two sources: an
 * approved documentation asset, read from its own private R2 bucket (#1650),
 * or `image.anitabi.cn` (unchanged behaviour, ported from entry.js). */
export async function handleImageProxy(
  request: Request, ctx: WorkerExecutionContext, docsAssets?: R2ObjectBucket,
): Promise<Response> {
  const imagePath = imagePathOf(request);
  return imagePath === null ? refusedPath() : sourceResponse(request, imagePath, docsAssets, ctx);
}

/** The Anitabi origin arm, with its own cache in front of it. */
async function proxiedImageResponse(request: Request, imagePath: string, ctx: WorkerExecutionContext): Promise<Response> {
  const cacheKey = new Request(request.url, request);
  const cache: Cache = caches.default;
  const cached: Response | undefined = await cache.match(cacheKey);
  if (cached) return cached;
  const response = await imageResponse(imagePath, request);
  if (response.ok) cacheWrite(ctx, cache.put(cacheKey, response.clone()), "edge_image_cache_write_failed");
  return response;
}
