import { vi } from "vitest";

/**
 * The real `@neondatabase/auth` module init blanks jsdom `localStorage`.
 * Unit tests never talk to a live Neon Auth origin; keep the SDK off the graph.
 * Per-file mocks (neon-auth.test.ts, session.test.tsx) override this shape.
 */
vi.mock("@neondatabase/auth", () => ({
  createAuthClient: vi.fn(() => ({
    signIn: { magicLink: vi.fn() },
    token: vi.fn(),
    getSession: vi.fn(),
  })),
}));

vi.mock("@neondatabase/auth/vanilla", () => ({
  BetterAuthVanillaAdapter: vi.fn(() => vi.fn()),
}));
