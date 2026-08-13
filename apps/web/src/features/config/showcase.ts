import { currentRuntimeConfig } from "../../lib/runtime-config/provider";

/**
 * Landing-only showcase flag (#1013 AC1). It moved out of build-time
 * `VITE_SHOWCASE_MODE` into the versioned runtime config's strictly-typed
 * `"true"/"false"` field; the runtime-config loader rejects any other value
 * fail-closed, so this resolves the already-validated flag rather than
 * re-parsing or throwing.
 */
export function isShowcase(): boolean {
  return currentRuntimeConfig().showcaseMode === "true";
}
