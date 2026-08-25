import { useEffect } from "react";

/**
 * The cheapest path that reaches the agent container. Any request routed there
 * starts it, and this one needs neither a session nor a Turnstile token.
 */
const WARMUP_PATH = "/healthz";

/**
 * Start the agent container as the visitor arrives at chat, before they type.
 *
 * Cloudflare Containers scale to zero after the Container class's `sleepAfter`
 * (10 minutes by default; `RuntimeContainer` does not override it), so on a
 * low-traffic surface almost every visitor is the first one after a nap.
 * Measured against staging, that boot is 24.5s cold against 0.9s warm, and
 * today it is charged to whoever sends the first message.
 *
 * Arriving at chat is the signal worth acting on in both environments. Staging
 * hands `/` off to `/chat` on the first client effect, so this is within
 * milliseconds of the earliest possible moment; production gates chat behind
 * login, so reaching this page means the visitor is past that and about to
 * type, rather than one of the many who only ever see the landing page.
 *
 * Fire-and-forget by design: nothing renders differently, and a failure only
 * means the first turn pays the boot it would have paid anyway. Client-only by
 * construction — `useEffect` never runs during SSR, so a crawler indexing the
 * page does not wake a container.
 */
export function useAgentWarmup(): void {
  useEffect(() => {
    void fetch(WARMUP_PATH, { cache: "no-store" }).catch(() => undefined);
  }, []);
}
