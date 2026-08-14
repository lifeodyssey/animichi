import { beforeEach, vi } from "vitest";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/lib/runtime-config/runtime-config";

// Neutralize any ambient Neon Auth base URL so `fetchAuthToken` takes the
// "not configured -> undefined" path instead of hitting a real Neon Auth
// origin. The base URL now lives in the versioned runtime config global
// (#1013 AC1); the shared runtime-config setup clears it to the env-neutral
// default (auth not configured) before each test, applied again here so the
// ordering never depends on setup-file order. Keeps `authHeaders()` hermetic
// (anonymous) for every consumer test; auth-specific tests re-stub their value.
beforeEach(() => {
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, {
    ...DEFAULT_RUNTIME_CONFIG,
    neonAuthBaseUrl: undefined,
  });
});
