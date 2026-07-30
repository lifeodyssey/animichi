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
const stack = pulumi.getStack();
const mediaBucketName = stack === "prod" ? "catalog-media" : `catalog-media-${stack}`;
const accountId = config.require("cloudflareAccountId");
const webRoutesEnabled = config.getBoolean("webRoutesEnabled") ?? false;

// Route topology remains in Pulumi (split-brain rule). Root wrangler routes
// stay until S0.7 cutover flips this flag and removes route entries there.
// Keep this false by default; enabling requires:
//   pulumi config set webRoutesEnabled true
//   pulumi config set cloudflareZoneId <zone id>
//   pulumi config set webDomain <domain>

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

// ── Catalog: R2 media bucket ──────────────────────────────────────────────────
// catalog Worker uses MEDIA_BUCKET (see workers/catalog/src/media/r2.ts) for
// lazy-cached pilgrimage point photos. Pulumi owns the bucket; wrangler.toml
// references it by name (bucket_name = "catalog-media").
// catalog has NO public route — it is a service-binding target from edge Worker.
const catalogMediaBucket = new cloudflare.R2Bucket("catalog-media", {
  accountId,
  name: mediaBucketName,
  location: "apac",
});

if (webRoutesEnabled) {
  const cloudflareZoneId = config.require("cloudflareZoneId");
  const webDomain = config.require("webDomain");
  const webScript = stack === "prod" ? "animichi-web" : `animichi-web-${stack}`;
  const edgeScript = stack === "prod" ? "animichi" : `animichi-${stack}`;

  new cloudflare.WorkersRoute("animichi-web-route", {
    zoneId: cloudflareZoneId,
    pattern: `${webDomain}/*`,
    script: webScript,
  });

  new cloudflare.WorkersRoute("animichi-edge-v1-route", {
    zoneId: cloudflareZoneId,
    pattern: `${webDomain}/v1/*`,
    script: edgeScript,
  });

  new cloudflare.WorkersRoute("animichi-edge-img-route", {
    zoneId: cloudflareZoneId,
    pattern: `${webDomain}/img/*`,
    script: edgeScript,
  });

  new cloudflare.WorkersRoute("animichi-edge-healthz-route", {
    zoneId: cloudflareZoneId,
    pattern: `${webDomain}/healthz`,
    script: edgeScript,
  });
}

// ── Staging: WAF gate ─────────────────────────────────────────────────────────
// staging runs the same app as production *with anonymous access on*
// (`ANON_ACCESS_ENABLED = "true"`, root wrangler.toml), so there is no login to
// keep strangers out. A WAF custom rule gates the hostname instead.
//
// Why WAF and not Cloudflare Access: Access would do the same job, but the
// Playwright suite runs against staging and would need a service token. A
// header is cheaper. Both sit ahead of the Worker either way — custom rules run
// in `http_request_firewall_custom`, and Cloudflare's own docs are explicit
// that "Workers runs after the Cloudflare WAF and Cloudflare Access". A blocked
// request never reaches our code and is not billed as a Worker invocation.
//
// Two ways in: the `animichi_staging` cookie (set once per browser by hand) or
// the `x-staging-key` header (CI, curl). No regex — `matches` is Business+ and
// this zone is on Free, which allows 5 custom rules.
//
// This only works because `workers_dev = false` everywhere (#539): a
// `*.workers.dev` hostname is not on the zone and would bypass the WAF outright.
const stagingGateEnabled = config.getBoolean("stagingGateEnabled") ?? false;

// The stack check keeps this resource meaningful only on staging, even if the
// flag is accidentally enabled on another stack.
if (stagingGateEnabled && stack === "staging") {
  const gateZoneId = config.require("cloudflareZoneId");
  const stagingDomain = config.require("stagingDomain");
  const gateToken = config.requireSecret("stagingGateToken");

  // `pulumi.interpolate` already propagates secretness from `gateToken`, so the
  // explicit `pulumi.secret` is belt-and-braces — kept because the cost of
  // being wrong here is high and asymmetric. Per `AGENTS.md`, every `pulumi up`
  // is preceded by a `pulumi stack export` copied into R2; a value that is not
  // marked secret lands in that object in the clear. This repository is public,
  // so the token must never be reconstructible from anything we publish.
  // Parenthesised deliberately. Cloudflare's own examples omit them and rely on
  // `not` binding tighter than `and`, which is correct — but the two failure
  // modes of getting this wrong are "block every request to staging" and "block
  // none of them", and neither is visible until the rule is live. Explicit
  // grouping costs nothing and removes the question.
  const gateExpression = pulumi.secret(
    pulumi.interpolate`(http.host eq "${stagingDomain}") and not (http.cookie contains "animichi_staging=${gateToken}") and not (any(http.request.headers["x-staging-key"][*] eq "${gateToken}"))`,
  );

  new cloudflare.Ruleset("staging-access-gate", {
    zoneId: gateZoneId,
    name: "staging access gate",
    kind: "zone",
    phase: "http_request_firewall_custom",
    description: "Restrict the staging hostname to holders of the gate token.",
    rules: [
      {
        action: "block",
        expression: gateExpression,
        description: "Block staging traffic carrying neither the gate cookie nor the gate header",
        enabled: true,
      },
    ],
  });
}

export const wave0 = pulumi.output("spike-validated");
export const catalogBucketName = catalogMediaBucket.name;
