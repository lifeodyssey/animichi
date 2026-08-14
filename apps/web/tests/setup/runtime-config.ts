import { beforeEach, vi } from "vitest";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/lib/runtime-config/runtime-config";

/**
 * Test seam for the versioned runtime config (#1013 AC1).
 *
 * Every suite starts from the env-neutral default (showcase off, no auth base,
 * no beacon, same-origin APIs) so nothing leaks between tests. Tests that need
 * a concrete environment write the whole config via {@link stubRuntimeConfig};
 * it is cleared again by vi's automatic global unstubbing on teardown.
 */

export function clearRuntimeConfig(): void {
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, undefined);
}

export function stubRuntimeConfig(config: Partial<typeof DEFAULT_RUNTIME_CONFIG>): void {
  clearRuntimeConfig();
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, ...config });
}

/** Baseline: unambiguous env-neutral defaults for every not-about-runtime-config test. */
beforeEach(() => {
  clearRuntimeConfig();
});
