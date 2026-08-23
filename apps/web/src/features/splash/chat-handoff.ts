import { useEffect } from "react";

/**
 * Owner 2026-08-23: `/` is a doorway for everyone, not just for narrow
 * viewports. There is no breakpoint left to read and no dwell timer: the
 * hand-off fires on the first client effect at every width, and the splash
 * stays up until chat itself paints and releases it (see `splash-release.ts`
 * and the `data-splash-release` rule in globals.css) — so the doorway
 * underneath `/` is never uncovered in between, no matter how long the chat
 * chunk and loader take to arrive.
 *
 * The doorway summary still renders server-side (features/seo/DoorwaySummary),
 * so crawlers and share previews keep getting a real page; only the human
 * visitor is carried through.
 */
export function useChatHandoff(enter: () => void): void {
  useEffect(() => { enter(); }, [enter]);
}
