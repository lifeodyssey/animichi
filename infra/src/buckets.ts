import * as cloudflare from "@pulumi/cloudflare";
import { accountId, mediaBucketName, mapTilesBucketName } from "./config.ts";

// ── Catalog: R2 media bucket ──────────────────────────────────────────────────
// catalog Worker uses MEDIA_BUCKET (see workers/catalog/src/media/r2.ts) for
// lazy-cached pilgrimage point photos. Pulumi owns the bucket; wrangler.toml
// references it by name (bucket_name = "catalog-media").
// catalog has NO public route — it is a service-binding target from edge Worker.
// #487: deleteBeforeReplace avoids account-global name collisions during replacement.
// protect prevents accidental deletion of unrecoverable bucket data.
//
// TODO(refactor-skeleton): lifecycle/retain policies — see #521

const bucketOpts = { protect: true, deleteBeforeReplace: true } as const;

export const catalogMediaBucket = new cloudflare.R2Bucket(
  "catalog-media",
  { accountId, name: mediaBucketName, location: "apac" },
  bucketOpts,
);

// Map tiles, glyphs, sprites, and style JSON are private R2 objects. The edge
// Worker is the sole public reader through `/tiles/*`; there is intentionally
// no R2 public bucket/domain configuration here. Production and staging use
// stable names consumed by their matching wrangler environment; an unrecognised
// preview stack gets an isolated suffix instead of sharing either live bucket.
export const mapTilesBucket = new cloudflare.R2Bucket(
  "map-tiles",
  { accountId, name: mapTilesBucketName, location: "apac" },
  bucketOpts,
);
