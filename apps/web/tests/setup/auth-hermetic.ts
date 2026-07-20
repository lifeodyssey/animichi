import { beforeEach, vi } from "vitest";

// Neutralize any ambient VITE_NEON_AUTH_BASE_URL (e.g. a dev machine's
// apps/web/.env.local) so `fetchAuthToken` takes the "not configured -> undefined"
// path instead of hitting a real Neon Auth origin. Keeps `authHeaders()` hermetic
// (anonymous) for every consumer test; auth-specific tests re-stub their own value.
beforeEach(() => {
  vi.stubEnv("VITE_NEON_AUTH_BASE_URL", "");
});
