import { useEffect } from "react";

/**
 * Owner 2026-08-23: the mobile index splash is released by an event, not a
 * clock — "the destination has painted", never "enough time has passed".
 *
 * Two document-level marks drive it, both read by CSS in globals.css so the
 * dismissal itself stays a CSS step-end keyframe (no second JS timer):
 *
 * - `data-splash-mobile-handoff` is stamped by a pre-hydration inline script
 *   when the initial viewport is mobile. It locks the splash and navigation to
 *   the same initial classification even if the viewport later changes.
 * - `data-splash-release` is stamped by the destination route's first commit.
 *   It shortens the hold back to the plain delay, which has long since elapsed,
 *   so the splash clears on the very frame the destination paints.
 *
 * Direction of the dependency: routes (UI) import this feature; the splash
 * component never imports a route. Nothing here runs during render, so SSR
 * emits no mark and hydration has nothing to mismatch on.
 */
export const SPLASH_SCRIPTING_ATTRIBUTE = "data-splash-scripting";

export const SPLASH_MOBILE_HANDOFF_ATTRIBUTE = "data-splash-mobile-handoff";

export const SPLASH_RELEASE_ATTRIBUTE = "data-splash-release";

export const MOBILE_CHAT_BREAKPOINT_PX = 640;

export const MOBILE_CHAT_QUERY = `(max-width: ${String(MOBILE_CHAT_BREAKPOINT_PX)}px)`;

/** Pre-hydration marks keep the initial viewport decision stable. */
export const SPLASH_SCRIPTING_MARK_SCRIPT =
  `document.documentElement.setAttribute("${SPLASH_SCRIPTING_ATTRIBUTE}","");if(window.matchMedia&&window.matchMedia(${JSON.stringify(MOBILE_CHAT_QUERY)}).matches)document.documentElement.setAttribute("${SPLASH_MOBILE_HANDOFF_ATTRIBUTE}","");`;

/** Called by the route the splash is covering for; releasing it is its job. */
export function useSplashRelease(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(SPLASH_RELEASE_ATTRIBUTE, "");
    return () => { root.removeAttribute(SPLASH_RELEASE_ATTRIBUTE); };
  }, []);
}
