import { useEffect } from "react";
import { SPLASH_MOBILE_HANDOFF_ATTRIBUTE } from "./splash-release";

/**
 * Mobile enters chat on the first client effect with no dwell timer. Desktop
 * stays on the doorway until its CTA is activated. The splash stays up for the
 * mobile hand-off until chat paints and releases it (see `splash-release.ts`).
 *
 * The doorway summary still renders server-side (features/seo/DoorwaySummary),
 * so crawlers, share previews, and desktop visitors get a real page.
 */
export function useChatHandoff(enter: () => void): void {
  useEffect(() => {
    if (document.documentElement.hasAttribute(SPLASH_MOBILE_HANDOFF_ATTRIBUTE)) enter();
  }, [enter]);
}
