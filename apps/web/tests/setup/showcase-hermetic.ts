import { beforeEach, vi } from "vitest";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/lib/runtime-config/runtime-config";

// Neutralize any ambient showcase mode (e.g. a dev machine's injected runtime
// config) so every suite that is not about showcase mode runs the landing in
// the live-app branch. The value now lives in the versioned runtime config
// global (#1013 AC1) rather than the old build-time VITE_SHOWCASE_MODE; the
// runtime-config loader accepts only "true"/"false", and "false" is the
// hermetic baseline. showcase-mode suites re-stub per case.
beforeEach(() => {
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, {
    ...DEFAULT_RUNTIME_CONFIG,
    showcaseMode: "false",
  });
});
