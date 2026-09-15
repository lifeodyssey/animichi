import * as pulumi from "@pulumi/pulumi";

// Wave 0 spike (2026-06-23) validated:
//   - Pulumi auto-provisions Cloudflare resources (R2 bucket + DNS + Workers
//     routes) with only a scoped CLOUDFLARE_API_TOKEN, using local state.
//   - `wrangler deploy` of a no-route worker does NOT clobber Pulumi-managed
//     routes → "routes belong to Pulumi, worker code belongs to wrangler".
//
// Wave 2 (Task 4): catalog infra added below.
// Wave 2+ will declare real infra parameterized per stack (prod / staging) —
// R2 (media + Pulumi state), Worker routes/custom domains, DNS, secrets.
// See docs/archive/specs/2026-06-23-platform-monorepo-cf-deploy-design.md

export const config = new pulumi.Config();
export const stack = pulumi.getStack();

/** One naming scheme for every bucket: production names are stable (the matching
 * wrangler environment consumes them by name), and any other stack carries its
 * own suffix so a preview can neither read nor overwrite a live bucket. The
 * per-bucket functions below are what the topology tests and `buckets.ts` read;
 * four copies of the ladder was four places for the scheme to drift (#1650
 * review S17). */
export function bucketNameFor(prodName: string, stackName: string): string {
  return stackName === "prod" ? prodName : `${prodName}-${stackName}`;
}

/** Catalog media, served through the catalog Worker's `MEDIA_BUCKET`. */
export function mediaBucketNameFor(stackName: string): string {
  return bucketNameFor("catalog-media", stackName);
}

/** Private map tiles, served only through the edge Worker's `/tiles/*` arm. */
export function mapTilesBucketNameFor(stackName: string): string {
  return bucketNameFor("map-tiles", stackName);
}

/** Immutable catalog snapshots (issue #1012). */
export function snapshotBucketNameFor(stackName: string): string {
  return bucketNameFor("catalog-snapshots", stackName);
}

/** Private documentation assets (#1650), served only through the edge Worker's
 * `/img/docs/*` arm. */
export function docsAssetsBucketNameFor(stackName: string): string {
  return bucketNameFor("docs-assets", stackName);
}

export const mediaBucketName = mediaBucketNameFor(stack);
export const mapTilesBucketName = mapTilesBucketNameFor(stack);
export const snapshotBucketName = snapshotBucketNameFor(stack);
export const docsAssetsBucketName = docsAssetsBucketNameFor(stack);
export const accountId = config.require("cloudflareAccountId");
export const webRoutesEnabled = config.getBoolean("webRoutesEnabled") ?? false;

// Custom Domains own the web origins because they provide the originless Worker
// hostname and certificate; explicit routes then take precedence for the edge
// API paths. One flag gates DNS and those narrowed routes together, so enabling
// it cannot publish the apex while it still falls through to the edge JSON 404.
// Keep this false by default; enabling requires:
//   pulumi config set webRoutesEnabled true
//   pulumi config set cloudflareZoneId <zone id>
//   pulumi config set webDomain <domain>
//   pulumi config set stagingDomain staging.animichi.com
//   pulumi config set wwwDomain www.animichi.com
