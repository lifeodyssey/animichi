/// <reference types="@cloudflare/workers-types" />

const TILE_PREFIX = "/tiles/";
const OBJECT_PREFIX = "tiles/";
const MAX_PATH_LENGTH = 256;
const ALLOWLISTED_EXTENSIONS = /\.(?:pmtiles|mvt|pbf|json|png|webp)$/i;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 .,+'@_-]*$/;
const ARCHIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*\.pmtiles$/i;
const VECTOR_PATH = /^(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.mvt$/i;
const GLYPH_PATH = /^fonts\/[^/]+\/[^/]+\.pbf$/i;
const SPRITE_PATH = /^sprites\/[^/]+\/[^/]+\.(?:json|png|webp)$/i;
const STYLE_PATH = /^styles\/[^/]+\.json$/i;
const RANGE_PATTERN = /^bytes=(\d+)-(\d*)$/;
const SUFFIX_RANGE_PATTERN = /^bytes=-(\d+)$/;

type TileAssetKind = "archive" | "vector" | "metadata" | "image";

type TileAsset = Readonly<{
  key: string;
  kind: TileAssetKind;
  contentType: string;
}>;

type TileRange = Readonly<{ offset: number; length?: number; suffix?: number }>;

type TileGetOptions = Readonly<{ range?: TileRange }>;

type TileObject = Readonly<{
  body: ReadableStream<Uint8Array> | null;
  etag: string;
  httpEtag?: string;
  size: number;
  range?: Readonly<{ offset: number; length: number }>;
  httpMetadata?: Readonly<{
    contentType?: string;
    cacheControl?: string;
    contentEncoding?: string;
  }>;
}>;

export interface TileBucket {
  get(key: string, options?: TileGetOptions): Promise<TileObject | null>;
}

export interface TileExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  json: "application/json",
  mvt: "application/vnd.mapbox-vector-tile",
  pbf: "application/x-protobuf",
  pmtiles: "application/octet-stream",
  png: "image/png",
  webp: "image/webp",
};

const errorResponse = (status: number, code: string, request: Request): Response => {
  return Response.json({ error: code }, { status, headers: responseHeaders(request) });
};

const responseHeaders = (request: Request): Headers => {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400, immutable",
    Vary: "Origin",
  });
  if (request.headers.has("Origin")) headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, ETag");
  return headers;
};

const extensionOf = (key: string): string => key.slice(key.lastIndexOf(".") + 1).toLowerCase();

const kindOf = (extension: string): TileAssetKind => {
  if (extension === "pmtiles") return "archive";
  if (extension === "mvt") return "vector";
  if (extension === "json" || extension === "pbf") return "metadata";
  return "image";
};

const validVectorCoordinates = (path: string): boolean => {
  const match = VECTOR_PATH.exec(path);
  if (!match) return false;
  const zoom = Number(match[1]);
  const maxCoordinate = 2 ** zoom;
  return zoom <= 22 && Number(match[2]) < maxCoordinate && Number(match[3]) < maxCoordinate;
};

const allowlistedPath = (path: string): boolean => {
  return ARCHIVE_PATH.test(path) || validVectorCoordinates(path) || GLYPH_PATH.test(path) || SPRITE_PATH.test(path) || STYLE_PATH.test(path);
};

const decodePath = (pathname: string): string | null => {
  if (!pathname.startsWith(TILE_PREFIX) || pathname.length > TILE_PREFIX.length + MAX_PATH_LENGTH) return null;
  const encodedPath = pathname.slice(TILE_PREFIX.length);
  if (/%2f|%5c/i.test(encodedPath)) return null;
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
};

const safeAsset = (pathname: string): TileAsset | null => {
  const decoded = decodePath(pathname);
  if (!decoded || decoded.includes("\\") || !ALLOWLISTED_EXTENSIONS.test(decoded) || !allowlistedPath(decoded)) return null;
  const segments = decoded.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || !SAFE_SEGMENT.test(segment))) return null;
  const extension = extensionOf(decoded);
  return { key: `${OBJECT_PREFIX}${decoded}`, kind: kindOf(extension), contentType: MIME_TYPES[extension] ?? "application/octet-stream" };
};

const parseRange = (value: string | null): TileRange | null | undefined => {
  if (value === null) return null;
  const range = RANGE_PATTERN.exec(value);
  if (range) {
    const offset = Number(range[1]);
    const end = range[2] === "" ? undefined : Number(range[2]);
    if (end !== undefined && end < offset) return undefined;
    return { offset, ...(end === undefined ? {} : { length: end - offset + 1 }) };
  }
  const suffix = SUFFIX_RANGE_PATTERN.exec(value);
  if (suffix && Number(suffix[1]) > 0) return { offset: 0, suffix: Number(suffix[1]) };
  return undefined;
};

const cache = (): Cache | null => {
  if (typeof caches === "undefined") return null;
  return caches.default;
};

const cacheKey = (request: Request): Request => new Request(new URL(request.url).origin + new URL(request.url).pathname, request);

const cacheHit = async (request: Request): Promise<Response | null> => {
  const storage = cache();
  return storage ? (await storage.match(cacheKey(request))) ?? null : null;
};

const cachePut = (request: Request, response: Response, ctx: TileExecutionContext): void => {
  const storage = cache();
  if (storage) ctx.waitUntil(storage.put(cacheKey(request), response.clone()));
};

const setRangeHeaders = (headers: Headers, object: TileObject, range: TileRange | null): void => {
  if (!range || !object.range) return;
  const start = String(object.range.offset);
  const end = String(object.range.offset + object.range.length - 1);
  headers.set("Content-Range", `bytes ${start}-${end}/${String(object.size)}`);
};

const setBodyHeaders = (headers: Headers, object: TileObject): void => {
  if (object.body) headers.set("Content-Length", String(object.range?.length ?? object.size));
};

const metadataHeaders = (asset: TileAsset, object: TileObject, request: Request, range: TileRange | null): Headers => {
  const headers = responseHeaders(request);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", object.httpMetadata?.contentType ?? asset.contentType);
  headers.set("ETag", object.httpEtag ?? object.etag);
  if (object.httpMetadata?.contentEncoding) headers.set("Content-Encoding", object.httpMetadata.contentEncoding);
  setRangeHeaders(headers, object, range);
  setBodyHeaders(headers, object);
  return headers;
};

const methodResponse = (request: Request): Response | null => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(request) });
  if (request.method === "GET" || request.method === "HEAD") return null;
  return errorResponse(405, "tile_method_not_allowed", request);
};

const missingResponse = (asset: TileAsset, request: Request): Response => {
  return asset.kind === "vector" ? new Response(null, { status: 204, headers: responseHeaders(request) }) : errorResponse(404, "tile_not_found", request);
};

const objectResponse = (asset: TileAsset, object: TileObject, request: Request, range: TileRange | null): Response => {
  const status = range && object.range ? 206 : 200;
  const body = request.method === "HEAD" ? null : object.body;
  return new Response(body, { status, headers: metadataHeaders(asset, object, request, range) });
};

const fetchAsset = async (asset: TileAsset, request: Request, bucket: TileBucket, ctx: TileExecutionContext): Promise<Response> => {
  const range = parseRange(request.headers.get("Range"));
  if (range === undefined) return errorResponse(416, "tile_range_not_satisfiable", request);
  const cached = range === null ? await cacheHit(request) : null;
  if (cached) return new Response(request.method === "HEAD" ? null : cached.body, { status: cached.status, headers: cached.headers });
  const object = await bucket.get(asset.key, range === null ? undefined : { range });
  if (!object) return missingResponse(asset, request);
  const response = objectResponse(asset, object, request, range);
  if (range === null && response.status === 200) cachePut(request, response, ctx);
  return response;
};

export async function handleTiles(request: Request, bucket: TileBucket | undefined, ctx: TileExecutionContext): Promise<Response> {
  const method = methodResponse(request);
  if (method) return method;
  const asset = safeAsset(new URL(request.url).pathname);
  if (!asset) return errorResponse(404, "tile_not_found", request);
  if (!bucket) return errorResponse(503, "tile_storage_unavailable", request);
  try {
    return await fetchAsset(asset, request, bucket, ctx);
  } catch {
    return errorResponse(503, "tile_storage_unavailable", request);
  }
}
