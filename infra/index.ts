import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

// Wave 0 spike (2026-06-23) validated:
//   - Pulumi auto-provisions Cloudflare resources (R2 bucket + DNS + Workers
//     routes) with only a scoped CLOUDFLARE_API_TOKEN, using local state.
//   - `wrangler deploy` of a no-route worker does NOT clobber Pulumi-managed
//     routes → "routes belong to Pulumi, worker code belongs to wrangler".
//
// Wave 2 (Task 4): catalog infra added below.
// Wave 2+ will declare real infra parameterized per stack (prod / staging) —
// R2 (media + Pulumi state), Workers routes (web `/*`, edge `/v1/*`+`/img/*`),
// DNS, secrets.
// See docs/superpowers/specs/2026-06-23-platform-monorepo-cf-deploy-design.md

const config = new pulumi.Config();
const accountId = config.require("cloudflareAccountId");

// ── Catalog: Neon DATABASE_URL (managed secret — stored in Pulumi config) ────
// Set production value via:
//   neonctl connection-string main --project-id $NEON_PROJECT_ID
//   pulumi config set --secret catalogDatabaseUrl <connstr> --stack prod
// No Hyperdrive needed: catalog uses @neondatabase/serverless (neon-http,
// HTTP transport, no raw socket). The CI deploy-catalog job passes this value
// to `wrangler secret put DATABASE_URL` (see .github/workflows/ci.yml).
// @pulumi/cloudflare v6 does not expose a WorkersSecret resource; the secret
// is passed through CI environment using the Pulumi output below.
export const catalogDatabaseUrl = config.requireSecret("catalogDatabaseUrl");

// ── Catalog: R2 media bucket ──────────────────────────────────────────────────
// catalog Worker uses MEDIA_BUCKET (see workers/catalog/src/media/r2.ts) for
// lazy-cached pilgrimage point photos. Pulumi owns the bucket; wrangler.toml
// references it by name (bucket_name = "catalog-media").
// catalog has NO public route — it is a service-binding target from edge Worker.
const catalogMediaBucket = new cloudflare.R2Bucket("catalog-media", {
  accountId,
  name: "catalog-media",
  location: "APAC",
});

export const wave0 = pulumi.output("spike-validated");
export const catalogBucketName = catalogMediaBucket.name;
