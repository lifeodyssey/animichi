/// <reference types="@cloudflare/workers-types" />

import type { CacheWriteContext } from "./cache-write.ts";
import {
  errorResponse, methodResponse, privateR2AssetResponse, responseHeaders,
  type PrivateR2Arm, type R2Asset, type R2ObjectBucket,
} from "./private-r2-object.ts";

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

/** Tiles are immutable per URL and keyed by `x/y/z` or a fixed asset name, so a
 * day at the browser and `immutable` at the edge is what the data supports. */
const TILE_CACHE_CONTROL = "public, max-age=86400, immutable";

type TileAssetKind = "archive" | "vector" | "metadata" | "image";

/** A tile the key grammar approved; the kind is what its absence means. */
type TileAsset = R2Asset & Readonly<{ kind: TileAssetKind }>;

const MIME_TYPES: Readonly<Record<string, string>> = {
  json: "application/json",
  mvt: "application/vnd.mapbox-vector-tile",
  pbf: "application/x-protobuf",
  pmtiles: "application/octet-stream",
  png: "image/png",
  webp: "image/webp",
};

/** The tile arm's refusals, cache lifetime and missing-object answer. A vector
 * tile that is not in the bucket is an EMPTY TILE: a gap in the archive means
 * "nothing here", and MapLibre renders nothing either way — the client must not
 * read it as a broken map or as a storage fault. */
const TILE_ARM: PrivateR2Arm<TileAsset> = {
  cacheControl: TILE_CACHE_CONTROL,
  methodCode: "tile_method_not_allowed",
  rangeCode: "tile_range_not_satisfiable",
  storageCode: "tile_storage_unavailable",
  cacheWriteEvent: "edge_tile_cache_write_failed",
  missing: (asset, request) => asset.kind === "vector"
    ? new Response(null, { status: 204, headers: responseHeaders(request, TILE_CACHE_CONTROL) })
    : errorResponse(404, "tile_not_found", request),
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
  if (!pathname.startsWith(TILE_PREFIX) || pathname.length > TILE_PREFIX.length + MAX_PATH_LENGTH || /%2f|%5c/i.test(pathname)) return null;
  try {
    return decodeURIComponent(pathname.slice(TILE_PREFIX.length));
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

const assetFor = (request: Request): TileAsset | null => safeAsset(new URL(request.url).pathname);

export async function handleTiles(request: Request, bucket: R2ObjectBucket | undefined, ctx: CacheWriteContext): Promise<Response> {
  const method = methodResponse(request, TILE_ARM);
  if (method) return method;
  const asset = assetFor(request);
  if (!asset) return errorResponse(404, "tile_not_found", request);
  return privateR2AssetResponse(asset, request, bucket, ctx, TILE_ARM);
}
