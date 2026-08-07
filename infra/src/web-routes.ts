import * as cloudflare from "@pulumi/cloudflare";
import { accountId, config, stack, webRoutesEnabled } from "./config"

// The legacy ruleset identity derives from the zone id, not the list position,
// so reordering `legacyRedirectZones` never churns Pulumi state. A duplicate
// id would declare two rulesets with the same Cloudflare `name` in the same
// zone and fight on `pulumi up`; the list is operator-supplied, so fail the
// build loudly instead of applying a conflicting declaration.
export function validateLegacyRedirectZones(zoneIds: string[]): void {
  const seen = new Set<string>();
  for (const zoneId of zoneIds) {
    if (seen.has(zoneId)) {
      throw new Error(`legacyRedirectZones lists "${zoneId}" more than once`);
    }
    seen.add(zoneId);
  }
}

function requireKnownStack(): void {
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
}

function apexDomainForStack(): string {
  return stack === "prod"
    ? config.require("webDomain")
    : config.require("stagingDomain");
}

function workerScripts(): { web: string; edge: string } {
  return {
    web: stack === "prod" ? "animichi-web" : `animichi-web-${stack}`,
    edge: stack === "prod" ? "animichi" : `animichi-${stack}`,
  };
}

function provisionEdgeRoutes(
  zoneId: string,
  apex: string,
  edgeScript: string,
): void {
  const routes: Array<[string, string]> = [
    ["animichi-edge-v1-route", `${apex}/v1/*`],
    ["animichi-edge-img-route", `${apex}/img/*`],
    ["animichi-edge-tiles-route", `${apex}/tiles/*`],
    ["animichi-edge-healthz-route", `${apex}/healthz`],
  ];
  for (const [name, pattern] of routes) {
    new cloudflare.WorkersRoute(
      name,
      { zoneId, pattern, script: edgeScript },
      { deleteBeforeReplace: true },
    );
  }
}

function provisionLegacyRedirects(apex: string): void {
  // Legacy-domain 301s (seo-geo-plan §3 item 2 / iter-0 AC): the retired
  // production domains (`seichijunrei.app`, `seichijunrei.zhenjia.dev`; and
  // `aninavi.app` if held) 301 onto the canonical apex with path + query
  // preserved. Each legacy domain must be its own Cloudflare zone (DNS
  // delegated to CF — a manual-ops step, #545), so the config lists *zone
  // ids*, not domains: a rule in the animichi.com zone cannot match a
  // hostname another zone owns. Absent/empty config is a deliberate no-op
  // until an owner onboards a legacy domain; the ruleset appears in the
  // legacy zone only, and `expression: "true"` matches every request there
  // because that zone exists solely to redirect.
  if (stack !== "prod") return;
  const legacyZoneIds = config.getObject<string[]>("legacyRedirectZones") ?? [];
  validateLegacyRedirectZones(legacyZoneIds);
  for (const legacyZoneId of legacyZoneIds) {
    new cloudflare.Ruleset(`animichi-legacy-redirect-${legacyZoneId}`, {
      zoneId: legacyZoneId,
      name: `animichi legacy redirect ${legacyZoneId}`,
      kind: "zone",
      phase: "http_request_dynamic_redirect",
      description: "301 the legacy domain onto the canonical apex.",
      rules: [
        {
          action: "redirect",
          expression: "true",
          description: "301 every path onto the canonical apex path.",
          enabled: true,
          actionParameters: {
            fromValue: {
              statusCode: 301,
              preserveQueryString: true,
              targetUrl: {
                expression: `concat("https://${apex}", http.request.uri.path)`,
              },
            },
          },
        },
      ],
    });
  }
}

function provisionWwwRedirect(zoneId: string, apex: string): void {
  // `www` is prod-only: there is no `www.staging.animichi.com`.
  if (stack !== "prod") return;
  const wwwDomain = config.require("wwwDomain");

  new cloudflare.DnsRecord("animichi-www-placeholder", {
    zoneId,
    name: wwwDomain,
    type: "A",
    content: "192.0.2.0",
    proxied: true,
    ttl: 1,
  });

  new cloudflare.Ruleset("animichi-www-redirect", {
    zoneId,
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
              expression: `concat("https://${apex}", http.request.uri.path)`,
            },
          },
        },
      },
    ],
  });
}

if (webRoutesEnabled) {
  // The hostname this stack serves: prod owns the apex, every other stack its
  // own subdomain. Both get the SAME split — the Custom Domain is the origin
  // for pages, and the four routes run ahead of it for the API/map surfaces.
  // Staging must not be an exception: `apps/web` calls `/v1/chat`,
  // `/v1/photo-search`, `/v1/conversations/...` relative to its own origin, so a
  // staging hostname pointed wholly at the web Worker has no chat at all.
  requireKnownStack();
  const cloudflareZoneId = config.require("cloudflareZoneId");
  const apexDomain = apexDomainForStack();
  const { web: webScript, edge: edgeScript } = workerScripts();

  new cloudflare.WorkersCustomDomain(
    "animichi-web-domain",
    {
      accountId,
      hostname: apexDomain,
      service: webScript,
      zoneId: cloudflareZoneId,
    },
    { deleteBeforeReplace: true },
  );

  provisionEdgeRoutes(cloudflareZoneId, apexDomain, edgeScript);
  provisionLegacyRedirects(apexDomain);
  provisionWwwRedirect(cloudflareZoneId, apexDomain);
}
