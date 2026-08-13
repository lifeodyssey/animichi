/**
 * Cloudflare Web Analytics beacon (S0-v2 C5).
 *
 * The beacon is one external script carrying the site token in a
 * `data-cf-beacon` attribute:
 *
 *   <script defer src="https://static.cloudflareinsights.com/beacon.min.js"
 *     data-cf-beacon='{"token":"…"}'></script>
 *
 * It ships from the SSR <head> and is gated on the two build-time signals
 * that stay identical between the server and the client — the head
 * recomputes on every client navigation, so a request-scoped read (like the
 * noindex plugin's `APP_ENV`, which lives in the Nitro event context the
 * head cannot reach) would drop the tag after hydration:
 *
 *   • the Vite production build (`import.meta.env.PROD`) — `vite dev`, the
 *     test pool and local previews without a token never emit it;
 *   • the token itself (`runtimeConfig.cfBeaconToken`, #1013 AC1), supplied
 *     by the versioned runtime-config payload the deploy provides. Absence —
 *     or an empty value — means no beacon, gracefully. Staging stays
 *     beacon-free as long as its runtime config carries no beacon token.
 */
export const CF_WEB_ANALYTICS_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

export interface CfWebAnalyticsTag {
  readonly src: string;
  readonly defer: true;
  readonly "data-cf-beacon": string;
}

export function cfWebAnalyticsScripts(token: string | undefined, isProductionBuild: boolean): CfWebAnalyticsTag[] {
  if (!isProductionBuild || !token) return [];
  return [{ src: CF_WEB_ANALYTICS_SRC, defer: true, "data-cf-beacon": JSON.stringify({ token }) }];
}
