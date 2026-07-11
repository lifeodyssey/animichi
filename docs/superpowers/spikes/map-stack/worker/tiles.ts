import {
  Compression,
  EtagMismatch,
  PMTiles,
  ResolvedValueCache,
  TileType
} from "pmtiles";
import type { RangeResponse, Source } from "pmtiles";

interface Env {
  readonly BUCKET: R2BucketLike;
}

interface R2BucketLike {
  get(key: string, options: R2GetOptions): Promise<R2ObjectBodyLike | null>;
}

interface R2GetOptions {
  readonly range: { readonly offset: number; readonly length: number };
  readonly onlyIf?: { readonly etagMatches: string };
}

interface R2ObjectBodyLike {
  readonly etag: string;
  readonly body: ReadableStream | null;
  readonly httpMetadata?: {
    readonly cacheControl?: string;
    readonly cacheExpiry?: Date;
  };
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface TileRequest {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

const ARCHIVE_KEY = "tiles/uji-kyoto.pmtiles";
const ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const CACHE_CONTROL = "public, max-age=86400";

class KeyNotFoundError extends Error {}

const edgeCache = (): Cache => {
  return (caches as CacheStorage & { readonly default: Cache }).default;
};

const nativeDecompress = async (
  buffer: ArrayBuffer,
  compression: Compression
): Promise<ArrayBuffer> => {
  if (compression === Compression.None || compression === Compression.Unknown) {
    return buffer;
  }
  if (compression !== Compression.Gzip) {
    throw new Error("Compression method not supported");
  }
  const stream = new Response(buffer).body?.pipeThrough(new DecompressionStream("gzip"));
  if (!stream) {
    throw new Error("Unable to decompress PMTiles bytes");
  }
  return new Response(stream).arrayBuffer();
};

const sharedCache = new ResolvedValueCache(25, undefined, nativeDecompress);

class R2Source implements Source {
  constructor(private readonly env: Env) {}

  getKey(): string {
    return ARCHIVE_KEY;
  }

  async getBytes(
    offset: number,
    length: number,
    _signal?: AbortSignal,
    etag?: string
  ): Promise<RangeResponse> {
    const options: R2GetOptions = {
      range: { offset, length },
      ...(etag ? { onlyIf: { etagMatches: etag } } : {})
    };
    const response = await this.env.BUCKET.get(ARCHIVE_KEY, options);
    if (!response) {
      throw new KeyNotFoundError("Archive not found");
    }
    if (!response.body) {
      throw new EtagMismatch();
    }
    return {
      data: await response.arrayBuffer(),
      etag: response.etag,
      cacheControl: response.httpMetadata?.cacheControl,
      expires: response.httpMetadata?.cacheExpiry?.toISOString()
    };
  }
}

const parseTile = (pathname: string): TileRequest | null => {
  const match = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/.exec(pathname);
  if (!match) {
    return null;
  }
  return {
    z: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3])
  };
};

const corsHeaders = (request: Request): Headers => {
  const headers = new Headers({ Vary: "Origin" });
  const origin = request.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
};

const cachedResponse = async (
  request: Request,
  ctx: WorkerContext,
  body: ArrayBuffer | string | undefined,
  status: number
): Promise<Response> => {
  const headers = corsHeaders(request);
  headers.set("Cache-Control", CACHE_CONTROL);
  if (status === 200) {
    headers.set("Content-Type", "application/x-protobuf");
  }
  const response = new Response(body, { status, headers });
  ctx.waitUntil(edgeCache().put(request.url, response.clone()));
  return response;
};

const handleGet = async (request: Request, env: Env, ctx: WorkerContext): Promise<Response> => {
  const tile = parseTile(new URL(request.url).pathname);
  if (!tile) {
    return new Response("Not found", { status: 404, headers: corsHeaders(request) });
  }

  const cached = await edgeCache().match(request.url);
  if (cached) {
    const headers = new Headers(cached.headers);
    corsHeaders(request).forEach((value, key) => headers.set(key, value));
    return new Response(cached.body, { status: cached.status, headers });
  }

  const archive = new PMTiles(new R2Source(env), sharedCache, nativeDecompress);
  const header = await archive.getHeader();
  if (tile.z < header.minZoom || tile.z > header.maxZoom) {
    return cachedResponse(request, ctx, undefined, 204);
  }
  if (header.tileType !== TileType.Mvt) {
    return cachedResponse(request, ctx, "Archive is not MVT", 400);
  }

  const data = await archive.getZxy(tile.z, tile.x, tile.y);
  return data ? cachedResponse(request, ctx, data.data, 200) : cachedResponse(request, ctx, undefined, 204);
};

export default {
  // Mirrors the official Protomaps worker shape:
  // https://github.com/protomaps/PMTiles/tree/main/serverless/cloudflare
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(undefined, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders(request) });
    }
    try {
      return await handleGet(request, env, ctx);
    } catch (error: unknown) {
      if (error instanceof KeyNotFoundError) {
        return new Response("Archive not found", { status: 404, headers: corsHeaders(request) });
      }
      throw error;
    }
  }
};
