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
 * text and the nonce, so both the runtime plugin and the unit suite can drive
 * it with plain values.
 */

/** Where the render reads the nonce the request hook minted for this response. */
export const CSP_NONCE_CONTEXT_KEY = "cspNonce";

/** Connect origins the same hook resolved for this response. */
export const CSP_CONNECT_CONTEXT_KEY = "cspConnect";

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
 * Connect origins only the deployment knows: the Neon Auth origin the browser
 * SDK dials (#1013 carries it in the runtime config), as an origin — the SDK's
 * paths are its own business. A missing or unparseable value yields no extra
 * origin rather than a broken policy; an invalid `RUNTIME_CONFIG` is the
 * runtime-config plugin's failure to raise, and it already does.
 */
export function deploymentConnectOrigins(neonAuthBaseUrl: string | undefined): readonly string[] {
  if (neonAuthBaseUrl === undefined) return [];
  try {
    return [new URL(neonAuthBaseUrl).origin];
  } catch {
    return [];
  }
}
