import type { WorkerExecutionContext } from "../env.ts";
import { gatewayRejection } from "../gateway/responses.ts";
import { cacheWrite } from "./cache-write.ts";

/** A path the proxy refuses (empty or traversal), in the shared edge envelope
 * (EG-05) rather than the plain text it used to answer. */
function refusedPath(): Response {
  return gatewayRejection("image_path_invalid", 400, "The image path is not one this proxy serves.");
}

function imagePathOf(request: Request): string | null {
  const imagePath = new URL(request.url).pathname.slice(5);
  return !imagePath || imagePath.includes("..") ? null : imagePath;
}

async function fetchImage(imagePath: string): Promise<Response> {
  return fetch(`https://image.anitabi.cn/${imagePath}`, { headers: { "User-Agent": "Animichi/1.0" } });
}

function upstreamError(upstream: Response): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg" },
  });
}

function cacheableResponse(upstream: Response): Response {
  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "public, max-age=604800, s-maxage=2592000");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.delete("Set-Cookie");
  return new Response(upstream.body, { status: 200, headers });
}

async function imageResponse(imagePath: string): Promise<Response> {
  const upstream = await fetchImage(imagePath);
  return upstream.ok ? cacheableResponse(upstream) : upstreamError(upstream);
}

/** Image proxy + cache for image.anitabi.cn (unchanged behaviour, ported from entry.js). */
export async function handleImageProxy(request: Request, ctx: WorkerExecutionContext): Promise<Response> {
  const imagePath = imagePathOf(request);
  if (imagePath === null) return refusedPath();
  const cacheKey = new Request(request.url, request);
  const cache: Cache = caches.default;
  const cached: Response | undefined = await cache.match(cacheKey);
  if (cached) return cached;
  const response = await imageResponse(imagePath);
  if (response.ok) cacheWrite(ctx, cache.put(cacheKey, response.clone()), "edge_image_cache_write_failed");
  return response;
}
