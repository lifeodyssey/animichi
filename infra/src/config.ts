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
// See docs/superpowers/specs/2026-06-23-platform-monorepo-cf-deploy-design.md

export const config = new pulumi.Config();
export const stack = pulumi.getStack();

/** Prod uses stable names; other stacks get a stack suffix. */
export function mediaBucketNameFor(stackName: string): string {
  return stackName === "prod" ? "catalog-media" : `catalog-media-${stackName}`;
}

/** Staging has a fixed name; unknown preview stacks get an isolated suffix. */
export function mapTilesBucketNameFor(stackName: string): string {
  if (stackName === "prod") return "map-tiles";
  if (stackName === "staging") return "map-tiles-staging";
  return `map-tiles-${stackName}`;
}

export const mediaBucketName = mediaBucketNameFor(stack);
export const mapTilesBucketName = mapTilesBucketNameFor(stack);
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

// TODO(refactor-skeleton): ESC secrets wiring — see #674

// ── Catalog: Neon DATABASE_URL (managed secret — stored in Pulumi config) ────
// Optional and operator-set per stack via:
//   neonctl connection-string main --project-id $NEON_PROJECT_ID
//   pulumi config set --secret catalogDatabaseUrl <connstr> --stack prod
// No Hyperdrive needed: catalog uses @neondatabase/serverless (neon-http,
// HTTP transport, no raw socket). The CI deploy-catalog job passes this value
// to `wrangler secret put DATABASE_URL` (see .github/workflows/ci.yml).
// @pulumi/cloudflare v6 does not expose a WorkersSecret resource; the secret
// is passed through CI environment using the Pulumi output below.
export const catalogDatabaseUrl = config.getSecret("catalogDatabaseUrl");
