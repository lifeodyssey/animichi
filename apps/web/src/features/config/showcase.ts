import { currentRuntimeConfig } from "../../lib/runtime-config/provider";

/**
 * Showcase-mode flag (#1013 AC1).
 *
 * ⚠️ 2026-08-23: its only consumer was the landing page's `ComingSoonPopup`,
 * deleted with the landing. The runtime-config field, its fail-closed loader
 * and the deploy plumbing are all still live, so the reader is kept — but it
 * currently has NO call site. Either give showcase mode a surface on `/chat`
 * or retire the whole flag; do not leave it dangling indefinitely.
 *
 * It moved out of build-time
 * `VITE_SHOWCASE_MODE` into the versioned runtime config's strictly-typed
 * `"true"/"false"` field; the runtime-config loader rejects any other value
 * fail-closed, so this resolves the already-validated flag rather than
 * re-parsing or throwing.
 */
export function isShowcase(): boolean {
  return currentRuntimeConfig().showcaseMode === "true";
}
