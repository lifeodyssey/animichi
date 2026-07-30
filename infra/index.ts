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
// R2 (media + Pulumi state), Worker routes/custom domains, DNS, secrets.
// See docs/superpowers/specs/2026-06-23-platform-monorepo-cf-deploy-design.md

const config = new pulumi.Config();
const stack = pulumi.getStack();
const mediaBucketName = stack === "prod" ? "catalog-media" : `catalog-media-${stack}`;
const accountId = config.require("cloudflareAccountId");
const webRoutesEnabled = config.getBoolean("webRoutesEnabled") ?? false;

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
  location: "APAC",
});

if (webRoutesEnabled) {
  const cloudflareZoneId = config.require("cloudflareZoneId");
  const webScript = stack === "prod" ? "animichi-web" : `animichi-web-${stack}`;
  const edgeScript = stack === "prod" ? "animichi" : `animichi-${stack}`;

  // The hostname this stack serves: prod owns the apex, every other stack its
  // own subdomain. Both get the SAME split — the Custom Domain is the origin
  // for pages, and the three routes run ahead of it for the API surfaces.
  // Staging must not be an exception: `apps/web` calls `/v1/chat`,
  // `/v1/photo-search`, `/v1/conversations/...` relative to its own origin, so a
  // staging hostname pointed wholly at the web Worker has no chat at all.
  // Only two stacks have a hostname today. A third would fall into the
  // non-prod branch and read `stagingDomain` — and the natural way to bootstrap
  // one is copying `Pulumi.staging.yaml`, which carries `staging.animichi.com`.
  // That stack would then claim staging's hostname with its own Workers and
  // silently take it over on the next `pulumi up`. Fail loudly instead; adding
  // a stack should be a deliberate edit here, not an inherited surprise.
  if (stack !== "prod" && stack !== "staging") {
    throw new Error(
      `stack "${stack}" has no hostname mapping. Add one here rather than ` +
        `letting it inherit stagingDomain — see the comment above.`,
    );
  }
  const apexDomain =
    stack === "prod" ? config.require("webDomain") : config.require("stagingDomain");

  new cloudflare.WorkersCustomDomain("animichi-web-domain", {
    accountId,
    hostname: apexDomain,
    service: webScript,
    zoneId: cloudflareZoneId,
  });

  new cloudflare.WorkersRoute("animichi-edge-v1-route", {
    zoneId: cloudflareZoneId,
    pattern: `${apexDomain}/v1/*`,
    script: edgeScript,
  });

  new cloudflare.WorkersRoute("animichi-edge-img-route", {
    zoneId: cloudflareZoneId,
    pattern: `${apexDomain}/img/*`,
    script: edgeScript,
  });

  new cloudflare.WorkersRoute("animichi-edge-healthz-route", {
    zoneId: cloudflareZoneId,
    pattern: `${apexDomain}/healthz`,
    script: edgeScript,
  });

  // `www` is prod-only: there is no `www.staging.animichi.com`.
  if (stack === "prod") {
    const wwwDomain = config.require("wwwDomain");

    new cloudflare.DnsRecord("animichi-www-placeholder", {
      zoneId: cloudflareZoneId,
      name: wwwDomain,
      type: "A",
      content: "192.0.2.0",
      proxied: true,
      ttl: 1,
    });

    new cloudflare.Ruleset("animichi-www-redirect", {
      zoneId: cloudflareZoneId,
      name: "www to apex redirect",
      kind: "zone",
      phase: "http_request_dynamic_redirect",
      description: "Redirect the placeholder www hostname to the apex.",
      rules: [
        {
          action: "redirect",
          expression: `http.host eq "${wwwDomain}"`,
          description: "Redirect www traffic to the apex hostname.",
          enabled: true,
          actionParameters: {
            fromValue: {
              statusCode: 301,
              preserveQueryString: true,
              targetUrl: {
                expression: `concat("https://${apexDomain}", http.request.uri.path)`,
              },
            },
          },
        },
      ],
    });
  }
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
