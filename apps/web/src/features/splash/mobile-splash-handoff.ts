import { useEffect } from "react";

/** Below this width `/` is a doorway, not a destination — it hands off to /chat. */
export const MOBILE_SPLASH_BREAKPOINT_PX = 640;

export const MOBILE_SPLASH_QUERY = `(max-width: ${String(MOBILE_SPLASH_BREAKPOINT_PX)}px)`;

/** Only ever called from inside an effect, so it never runs during SSR render. */
function isMobileSplashViewport(): boolean {
  return window.matchMedia(MOBILE_SPLASH_QUERY).matches;
}

/**
 * Owner 2026-08-23: there is no dwell timer. The hand-off fires on the first
 * client effect, and the splash stays up until chat itself paints and releases
 * it (see `splash-release.ts` and the `data-splash-release` rule in
 * globals.css) — so the page underneath `/` is never uncovered in between,
 * no matter how long the chat chunk and loader take to arrive.
 */
export function useMobileSplashHandoff(enter: () => void): void {
  useEffect(() => { if (isMobileSplashViewport()) enter(); }, [enter]);
}
