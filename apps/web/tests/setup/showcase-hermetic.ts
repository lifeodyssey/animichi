import { vi } from "vitest";

// Neutralize any ambient VITE_SHOWCASE_MODE (e.g. a dev machine's
// apps/web/.env.local) so every suite that is not about showcase mode runs the
// landing in the live-app branch. Stubbed at module scope (not in beforeEach)
// because showcase.ts evaluates the env at module init and THROWS on any value
// other than "true"/"false" — the stub must be in place before the test file's
// imports evaluate. showcase-mode.test.ts re-stubs per case with
// vi.resetModules() to exercise that init-time contract directly.
vi.stubEnv("VITE_SHOWCASE_MODE", "false");
