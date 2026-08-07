import * as cloudflare from "@pulumi/cloudflare";
import { config, stack } from "./config.ts"

// ── Zone hardening: DNSSEC, CAA, API rate limit, HSTS ───────────────────────
// Owner ruling 2026-08-05 (prod security review), restructured per PR #776:
// these four are zone-scoped, and prod is the single owner of zone metadata.
// They started inside the `webRoutesEnabled` block, which meant staging and
// prod would BOTH declare the same zone resources and fight over them on
// `pulumi up`, and hardening was wrongly coupled to the publish flag.
// Guarded on the zoneId alone: a prod stack without the config simply skips —
// hardening activates when prod gains its zone config, independent of
// publishing. Public repo: no secrets, emails, or IPs — none of these
// resources need any.
//
// Note on the v6 resource names: `ZoneDnssec` (not `ZoneDnssecConfig`) and
// `ZoneSetting` with `settingId` were both confirmed against the local
// `@pulumi/cloudflare` v6 typings.

const hardeningZoneId = stack === "prod" ? config.get("cloudflareZoneId") : undefined;

function provisionCaaRecords(zoneId: string, webDomain: string): void {
  // CAA: restrict who may issue certificates for the domain to Cloudflare's
  // Universal SSL certificate partners — letsencrypt.org, pki.goog, ssl.com,
  // and digicert.com, each encoded as its own record (one tag per record).
  // Universal SSL keeps working because CF's partner CAs are listed.
  // The records pin the apex hostname, which prod sets via `webDomain`; until
  // that config exists they are skipped while DNSSEC, the rate limit, and
  // HSTS activate on the zoneId alone.
  const caaIssuers = [
    { name: "animichi-caa-letsencrypt", value: "letsencrypt.org" },
    { name: "animichi-caa-pki-goog", value: "pki.goog; cansignhttpexchanges=yes" },
    { name: "animichi-caa-ssl-com", value: "ssl.com" },
    { name: "animichi-caa-digicert", value: "digicert.com; cansignhttpexchanges=yes" },
  ];
  for (const { name, value } of caaIssuers) {
    new cloudflare.DnsRecord(name, {
      zoneId,
      name: webDomain,
      type: "CAA",
      ttl: 1,
      data: { flags: 0, tag: "issue", value },
    });
  }
}

function provisionApiRateLimit(zoneId: string): void {
  // One rate-limit rule (the Free plan allows exactly one): a broad
  // brute-force damper on the API surface — `/v1/*` — keyed by IP + colo,
  // challenging bursts past 60 requests per 10s for 10s. Turnstile and
  // per-route quotas do fine-grained control; this only shaves floods.
  // Scoped to the zone WITHOUT a host match: on this zone only the apex
  // serves `/v1/*` (www is a placeholder that 301-redirects in
  // `http_request_dynamic_redirect`, which runs before `http_ratelimit`), so
  // a bare path match is equivalent to the apex match and needs no `webDomain`
  // dependency.
  new cloudflare.Ruleset("animichi-api-rate-limit", {
    zoneId,
    name: "zone /v1 rate limit",
    kind: "zone",
    phase: "http_ratelimit",
    description: "Broad rate-limit damper on the /v1 API surface.",
    rules: [
      {
        action: "managed_challenge",
        expression: `starts_with(http.request.uri.path, "/v1/")`,
        description: "Challenge bursts past 60 requests per 10s on /v1.",
        enabled: true,
        ratelimit: {
          characteristics: ["ip.src", "cf.colo.id"],
          period: 10,
          requestsPerPeriod: 60,
          mitigationTimeout: 10,
        },
      },
    ],
  });
}

function provisionHsts(zoneId: string): void {
  // HSTS on the zone. `include_subdomains` false because the staging subdomain
  // policy may differ from prod; `preload` false deliberately — preloading is
  // near-irreversible (removing a domain from the preload list takes months),
  // so it must be a conscious follow-up decision, not a default.
  new cloudflare.ZoneSetting("animichi-security-header", {
    zoneId,
    settingId: "security_header",
    value: {
      strict_transport_security: {
        enabled: true,
        max_age: 15552000,
        include_subdomains: false,
        preload: false,
      },
    },
  });
}

if (hardeningZoneId) {
  const webDomain = config.get("webDomain");

  // DNSSEC signing on the zone. Cloudflare holds the keys and publishes the DS
  // record; there is deliberately nothing Pulumi-visible beyond the zone.
  new cloudflare.ZoneDnssec("animichi-dnssec", { zoneId: hardeningZoneId });

  if (webDomain !== undefined) {
    provisionCaaRecords(hardeningZoneId, webDomain);
  }
  provisionApiRateLimit(hardeningZoneId);
  provisionHsts(hardeningZoneId);
}
