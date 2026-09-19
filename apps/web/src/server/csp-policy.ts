/**
 * The one Content-Security-Policy the web app serves (issue #469; the
 * precondition the BYOK spec #284/OQ-6 accepted the sessionStorage key risk
 * against).
 *
 * What it buys and what it does not: an XSS on the chat page still runs in the
 * page's origin, so it can still read the BYOK key out of sessionStorage
 * (threat T11). CSP does not close T11. What it closes is the cheapest path to
 * that XSS — an injected inline `<script>` — by requiring every inline script
 * to carry the nonce minted for that one response. `'unsafe-inline'` here would
 * make the whole policy decorative, which is why the tests assert that an
 * un-nonced inline script is refused rather than that a header is present.
 *
 * Nothing in this module touches Nitro, h3 or the framework: it is the policy
 * text, the nonce, and the origins a deployment names, so both the request
 * middleware and the unit suite can drive it with plain values.
 */

import type { RuntimeConfig } from "../lib/runtime-config/runtime-config";

/** Where the render reads the nonce the request hook minted for this response. */
export const CSP_NONCE_CONTEXT_KEY = "cspNonce";

/** 128 bits. The nonce is a capability: it must be unguessable per response. */
const NONCE_BYTES = 16;

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** Where the Cloudflare Web Analytics beacon script is served from. */
const CF_INSIGHTS_SCRIPT_ORIGIN = "https://static.cloudflareinsights.com";

/** Where that beacon POSTs its measurements to. */
const CF_INSIGHTS_CONNECT_ORIGIN = "https://cloudflareinsights.com";

/** Base64url without padding, the alphabet CSP's `nonce-source` accepts. */
function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** A fresh nonce for one response, from the platform CSPRNG. */
export function mintNonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

/**
 * `'strict-dynamic'` makes the nonce the only script gate a CSP3 browser
 * honours: it ignores `'self'` and the host sources beside it for scripts, and
 * extends trust to scripts a trusted script creates. That is what lets the
 * Turnstile SDK — appended at runtime by our own module — load without a
 * second nonce. The host sources stay listed for browsers that predate
 * `'strict-dynamic'`, where they are the fallback rather than the rule.
 */
function scriptSrc(nonce: string): string {
  return ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", TURNSTILE_ORIGIN, CF_INSIGHTS_SCRIPT_ORIGIN].join(" ");
}

/** One directive per entry, in the order the header lists them. */
function directives(nonce: string, connect: readonly string[]): readonly (readonly [string, string])[] {
  return [...documentSources(nonce), ...connectionSources(connect), ...RESTRICTIONS];
}

/** Sources every rendered document needs, from its own origin or a nonce. */
function documentSources(nonce: string): readonly (readonly [string, string])[] {
  return [
    ["default-src", "'self'"],
    ["script-src", scriptSrc(nonce)],
    // No inline event handlers (`onclick=`): React binds listeners, so
    // refusing the attribute form removes a whole injection shape.
    ["script-src-attr", "'none'"],
    // `'unsafe-inline'` stays for styles only: MapLibre injects style elements
    // for its own container, and a blocked stylesheet is a broken map — the
    // failure mode that gets a CSP reverted. Inline style cannot execute
    // script, so it costs nothing against T11.
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", "'self' data: blob:"],
    ["font-src", "'self'"],
  ];
}

/** Where the page may reach, beyond its own origin. */
function connectionSources(connect: readonly string[]): readonly (readonly [string, string])[] {
  return [
    ["connect-src", ["'self'", CF_INSIGHTS_CONNECT_ORIGIN, ...connect].join(" ")],
    ["frame-src", TURNSTILE_ORIGIN],
    // MapLibre runs its workers from blob URLs.
    ["worker-src", "'self' blob:"],
  ];
}

/** Directives identical on every response; all of them close things off. */
const RESTRICTIONS: readonly (readonly [string, string])[] = [
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["frame-ancestors", "'none'"],
  ["manifest-src", "'self'"],
];

/** The header value for one response: every directive, in one string. */
export function contentSecurityPolicy(nonce: string, connect: readonly string[]): string {
  return directives(nonce, connect).map(([name, value]) => `${name} ${value}`).join("; ");
}

/**
 * The origins only the deployment knows, read off the runtime config (#1013).
 *
 * Every URL that config may name is one the app hands the browser as a request
 * base: `agentUrl` for chat and the Turnstile verdict, `catalogUrl`/`usersUrl`
 * for the oRPC clients, `neonAuthBaseUrl` for the auth SDK. `connect-src` is
 * the whole distance between such a base and the request it describes — the
 * browser refuses the fetch before any of our code is called, so a base the
 * policy omits is not a degraded feature, it is an unreachable one.
 *
 * The parameter is a projection of the runtime config's own type, not a copy of
 * its fields: a copy would keep compiling after a rename and would then quietly
 * stop listing an origin, which is the failure this function exists to prevent.
 * There is no second list; these are the fields `api/config.ts` resolves the
 * bases from.
 *
 * `api.siteOrigin` is deliberately absent. It is the SSR fallback for a request
 * that has no origin of its own, and the browser is never such a request —
 * `location.origin` answers for it, which is what `'self'` already covers.
 */
export type DeploymentConnectConfig = Pick<RuntimeConfig, "neonAuthBaseUrl" | "api">;

/**
 * As sources `connect-src` can carry: origins, and nothing for an unparseable
 * one. The SDK's and the services' paths are their own business, and a junk
 * value leaves the rest of the policy standing rather than voiding it; an
 * invalid `RUNTIME_CONFIG` is the runtime-config plugin's failure to raise,
 * and it already does.
 */
export function deploymentConnectOrigins(config: DeploymentConnectConfig): readonly string[] {
  return [config.neonAuthBaseUrl, config.api.agentUrl, config.api.catalogUrl, config.api.usersUrl].flatMap(originSource);
}

function originSource(url: string | undefined): readonly string[] {
  if (url === undefined) return [];
  try {
    return [new URL(url).origin];
  } catch {
    return [];
  }
}
