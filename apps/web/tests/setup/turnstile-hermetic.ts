import { beforeEach, vi } from "vitest";
import { clearTurnstileToken } from "../../src/lib/turnstile/tokenStore";

// Neutralize Turnstile for every suite that is not about it (issue #447).
// Vitest runs with `DEV === true`, which would otherwise hand the chat page the
// dev-fallback site key, mount a widget, and make `?q=` auto-send wait for a
// token it will never receive. Turnstile's own suites stub these back.
beforeEach(() => {
  // Also abandons any waiter a previous test parked on `awaitTurnstileToken`,
  // so a pending 15s timer cannot leak into the next test's event loop.
  clearTurnstileToken();
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
  vi.stubEnv("DEV", false);
});
