import { useEffect } from "react";

/** Same breakpoint the landing uses to switch to MobileFoxHome — one value, one truth. */
export const MOBILE_SPLASH_BREAKPOINT_PX = 640;

/** Owner 2026-08-21: how long the mobile splash dwells before entering /chat. */
export const MOBILE_SPLASH_DWELL_MS = 1500;

export const MOBILE_SPLASH_QUERY = `(max-width: ${String(MOBILE_SPLASH_BREAKPOINT_PX)}px)`;

const SKIP_EVENTS = ["pointerdown", "keydown"] as const;

/** Only ever called from inside an effect, so it never runs during SSR render. */
function isMobileSplashViewport(): boolean {
  return window.matchMedia(MOBILE_SPLASH_QUERY).matches;
}

/**
 * WCAG 2.2.1 Timing Adjustable: the dwell is a timed hand-off, so any pointer or
 * key input skips straight to it instead of forcing the visitor to wait it out.
 */
function armSplashDwell(enter: () => void): () => void {
  const timer = window.setTimeout(enter, MOBILE_SPLASH_DWELL_MS);
  const skip = () => { window.clearTimeout(timer); enter(); };
  for (const name of SKIP_EVENTS) window.addEventListener(name, skip);
  return () => {
    window.clearTimeout(timer);
    for (const name of SKIP_EVENTS) window.removeEventListener(name, skip);
  };
}

/** Mobile-only splash dwell; on desktop the hook subscribes to nothing. */
export function useMobileSplashHandoff(enter: () => void): void {
  useEffect(() => (isMobileSplashViewport() ? armSplashDwell(enter) : undefined), [enter]);
}
