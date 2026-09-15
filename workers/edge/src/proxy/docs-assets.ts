/// <reference types="@cloudflare/workers-types" />

/**
 * Documentation assets served from their own private R2 bucket through the
 * edge image proxy's reserved `/img/docs` namespace (#1650).
 *
 * The bucket is private and only ever read here: the URL path *is* the object
 * key, so an approved asset moves from the repository to the bucket without
 * being renamed, and `resolveDocsAsset` is the single gate in front of
 * `get()` — anything outside the allowlisted prefix and extensions is refused
 * before a binding is touched. The namespace is reserved rather than
 * best-effort, and it includes its own bare prefix: `/img/docs` and
 * `/img/docs/` are not assets, and no path inside the namespace is ever
 * forwarded to the image origin.
 *
 * The read itself — the `Range` gate, the edge cache, the 200/206 projection
 * and the storage refusals — is the shared private-R2 shell
 * (`proxy/private-r2-object.ts`), which this arm configures rather than copies.
 */

import type { CacheWriteContext } from "./cache-write.ts";
import { IMAGE_CACHE_CONTROL } from "./image-cache-control.ts";
import {
  errorResponse, methodResponse, privateR2AssetResponse,
  type PrivateR2Arm, type R2Asset, type R2ObjectBucket,
} from "./private-r2-object.ts";

/** The one `/img/` namespace this module owns: `/img/docs` and everything
 * under it. The bare prefix is inside the namespace, so it is refused rather
 * than resolved as an origin path. */
const DOCS_NAMESPACE = "docs";

/** Approved documentation assets live under one prefix — the `docs/archive/**`
 * half of the P7 binary strip. A new source of assets is a deliberate addition
 * here, not a path that happens to resolve. */
const APPROVED_KEY_PREFIX = "archive/";

const MAX_KEY_LENGTH = 256;
/** A dot-leading segment (`.`, `..`, a dotfile) can never match, so traversal
 * needs no separate rule here: `..` is unreachable by construction, and `%`
 * fails the class too, so no encoded form survives the allowlist either. */
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** An approved asset, and the object key it is stored under. */
export type DocsAsset = R2Asset;

/** The docs arm's refusals and cache lifetime. An approved key that the bucket
 * does not hold is a 404 in the shared envelope — the asset was named, so its
 * absence is not an empty answer. */
const DOCS_ASSET_ARM: PrivateR2Arm<DocsAsset> = {
  cacheControl: IMAGE_CACHE_CONTROL,
  methodCode: "image_method_not_allowed",
  rangeCode: "image_range_not_satisfiable",
  storageCode: "image_storage_unavailable",
  cacheWriteEvent: "edge_docs_asset_cache_write_failed",
  missing: (_asset, request) => errorResponse(404, "image_not_found", request),
};

/** `not-docs` is a path this namespace does not own — its caller serves it from
 * the image origin. `refused` is a path INSIDE the namespace that is not an
 * approved asset: it answers the same refusal the arm already gives a
 * traversal attempt, and never falls through to the origin. */
export type DocsAssetResolution =
  | Readonly<{ kind: "asset"; asset: DocsAsset }>
  | Readonly<{ kind: "not-docs" }>
  | Readonly<{ kind: "refused" }>;

const contentTypeOf = (key: string): string | undefined => {
  const dot = key.lastIndexOf(".");
  return dot === -1 ? undefined : CONTENT_TYPES[key.slice(dot + 1).toLowerCase()];
};

const approvedAsset = (key: string): DocsAsset | null => {
  if (key.length > MAX_KEY_LENGTH || !key.startsWith(APPROVED_KEY_PREFIX)) return null;
  const contentType = contentTypeOf(key);
  const segments = key.split("/");
  if (contentType === undefined || !segments.every((segment) => SAFE_SEGMENT.test(segment))) return null;
  return { key, contentType };
};

/** Which of this arm's three answers one `/img/` path gets. */
export function resolveDocsAsset(imagePath: string): DocsAssetResolution {
  if (imagePath === DOCS_NAMESPACE) return { kind: "refused" };
  if (!imagePath.startsWith(`${DOCS_NAMESPACE}/`)) return { kind: "not-docs" };
  const asset = approvedAsset(imagePath.slice(DOCS_NAMESPACE.length + 1));
  return asset === null ? { kind: "refused" } : { kind: "asset", asset };
}

/** The answer for one approved asset: this arm's method admission, then the
 * shared private-R2 read. */
export async function docsAssetResponse(
  request: Request, asset: DocsAsset, bucket: R2ObjectBucket | undefined, ctx: CacheWriteContext,
): Promise<Response> {
  const method = methodResponse(request, DOCS_ASSET_ARM);
  if (method) return method;
  return privateR2AssetResponse(asset, request, bucket, ctx, DOCS_ASSET_ARM);
}
