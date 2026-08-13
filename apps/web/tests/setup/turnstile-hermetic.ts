import { beforeEach, vi } from "vitest";
import { clearTurnstileToken } from "../../src/lib/turnstile/token-store";

// Neutralize Turnstile for every suite that is not about it (issue #447).
// The site key now resolves from the versioned runtime config global (#1013
// AC1); the shared runtime-config setup already clears that global to the
// env-neutral default before each test, which leaves the key `undefined`. We
// additionally pin `DEV` false so an unconfigured key behaves like a
// production build (no widget) rather than the dev-fallback test key.
// Turnstile's own suites stub these back.
beforeEach(() => {
  // Also abandons any waiter a previous test parked on `awaitTurnstileToken`,
  // so a pending 15s timer cannot leak into the next test's event loop.
  clearTurnstileToken();
  vi.stubEnv("DEV", false);
});
