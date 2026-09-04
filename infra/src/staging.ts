import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { config, stack, webRoutesEnabled } from "./config.ts"

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
// Three ways in: an allowlisted source IP (`stagingAllowedIps` — the #769 human
// path), the legacy `animichi_staging` cookie (set once per browser by hand) or
// `x-staging-key` header (CI, curl) — #769 card 3 removes the cookie/header
// path — and the CI-channel OIDC exchange endpoint `/staging-gate/exchange`
// (#1054 phase 2): CI swaps its GitHub OIDC identity there for a short-lived
// gate session. The WAF cannot cryptographically verify that opaque session, so
// through the OIDC rollout it remains the static gate token that lets the CI
// smoke past the WAF; deleting STAGING_GATE_TOKEN from GitHub Secrets (the
// ORCHESTRATOR's post-merge step once the OIDC switch is verified) is what
// moves the CI channel to the session. No regex — `matches` is Business+ and
// this zone is on Free, which allows 5 custom rules.
//
// This only works because `workers_dev = false` everywhere (#539): a
// `*.workers.dev` hostname is not on the zone and would bypass the WAF outright.

const stagingGateEnabled = config.getBoolean("stagingGateEnabled") ?? false;

// #769: parse the staging allowlist into a Cloudflare `ip.src in { ... }`
// clause (entries are space-separated inside the braces; plain IPs are allowed
// alongside CIDRs). Empty list → no clause. Anything else is interpolated into
// a firewall expression, so a non-IP entry must fail the build loudly.
export function validateIpEntry(entry: string): boolean {
  const v4 = entry.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/,
  );
  if (v4 !== null) {
    return (
      !v4.slice(1, 5).some((octet) => Number(octet) > 255) &&
      (v4[5] === undefined || Number(v4[5]) <= 32)
    );
  }
  const v6 = entry.match(/^[0-9a-fA-F:]+(?:\/(\d{1,3}))?$/);
  return v6 !== null && (v6[1] === undefined || Number(v6[1]) <= 128);
}

export function buildIpClause(raw: string): string {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) return "";
  const invalid = entries.find((entry) => !validateIpEntry(entry));
  if (invalid !== undefined) {
    throw new Error(
      `stagingAllowedIps entry "${invalid}" is not a valid IP or CIDR`,
    );
  }
  return ` and not (ip.src in {${entries.join(" ")}})`;
}

function validateGateToken(token: string): string {
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(token)) {
    throw new Error(
      "stagingGateToken must be >=16 chars of base64/hex/url-safe characters (no quotes, backslashes, or line breaks).",
    );
  }
  return token;
}

function buildGateExpression(
  stagingDomain: string,
  gateToken: pulumi.Output<string>,
  ipClause: pulumi.Output<string>,
): pulumi.Output<string> {
  // `pulumi.interpolate` already propagates secretness from `gateToken`, so the
  // explicit `pulumi.secret` is belt-and-braces — kept because the cost of
  // being wrong here is high and asymmetric. Per `AGENTS.md`, a value that is
  // not marked secret is stored in Pulumi Cloud state in the clear, and comes
  // back out in the clear in any `pulumi stack export` an operator takes. This
  // repository is public, so the token must never be reconstructible from
  // anything we publish.
  // Parenthesised deliberately. Cloudflare's own examples omit them and rely on
  // `not` binding tighter than `and`, which is correct — but the two failure
  // modes of getting this wrong are "block every request to staging" and "block
  // none of them", and neither is visible until the rule is live. Explicit
  // grouping costs nothing and removes the question.
  return pulumi.secret(
    pulumi.interpolate`(http.host eq "${stagingDomain}") and not (http.cookie contains "animichi_staging=${gateToken}") and not (any(http.request.headers["x-staging-key"][*] eq "${gateToken}"))${ipClause} and not (http.request.uri.path eq "/staging-gate/exchange")`,
  );
}

// The stack check keeps this resource meaningful only on staging, even if the
// flag is accidentally enabled on another stack.
if (stagingGateEnabled && stack === "staging") {
  const gateZoneId = config.require("cloudflareZoneId");
  const stagingDomain = config.require("stagingDomain");
  const gateTokenValidated = config.requireSecret("stagingGateToken").apply(validateGateToken);

  // #769: known-human egress IPs (CIDRs, comma-separated). Secret so the list
  // never lands readable in the public repo or an exported stack backup.
  const allowedIps = config.getSecret("stagingAllowedIps");
  const ipClause = (allowedIps ?? pulumi.output("")).apply(buildIpClause);
  const gateExpression = buildGateExpression(
    stagingDomain,
    gateTokenValidated,
    ipClause,
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
        description:
          "Block staging traffic without an allowlisted source IP, the gate cookie/header, or the exchange path",
        enabled: true,
      },
    ],
  });
}

// ── Staging: per-host config settings (CI smoke) ─────────────────────────────
// The IP-allowlist gate above is the staging hostname's protection. The WAF's
// browser-facing defenses would fight it here: a Browser Integrity Check (BIC)
// or Security Level challenge on the staging host makes the Playwright smoke
// suite (and any curl) answer a challenge instead of the app. One zone-scoped
// ruleset turns both off for the staging hostname only — every other hostname
// on the zone keeps the defaults. Gated on the web routes so preview stacks
// stay clean: this is meaningful only where the staging hostname actually
// serves the app.
if (webRoutesEnabled && stack === "staging") {
  const settingsZoneId = config.require("cloudflareZoneId");
  const settingsDomain = config.require("stagingDomain");

  new cloudflare.Ruleset("staging-http-config-settings", {
    zoneId: settingsZoneId,
    name: "staging http config settings",
    kind: "zone",
    phase: "http_config_settings",
    description: "Per-host config overrides for the staging hostname.",
    rules: [
      {
        action: "set_config",
        expression: `http.host eq "${settingsDomain}"`,
        description:
          "staging: CI smoke must not be browser-challenged; the IP-allowlist gate owns protection here",
        enabled: true,
        actionParameters: {
          bic: false,
          securityLevel: "essentially_off",
        },
      },
    ],
  });
}
