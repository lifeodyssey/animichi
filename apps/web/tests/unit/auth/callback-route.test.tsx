/**
 * @vitest-environment jsdom
 */
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRouter } from "../../../src/router";
import { setLanguages } from "../_i18n";
import { dictFor } from "../../../src/i18n/dictionaries";

/**
 * The desktop test viewport remains on `/`; only mobile hands off to chat.
 * The T14 open-redirect guard stays sharp: an honoured deep link arrives with
 * its search intact, while a rejected vector falls back to home with none.
 */
const SETTLED_HOME = "/";

const { establishAuthSession } = vi.hoisted(() => ({ establishAuthSession: vi.fn() }));
vi.mock("../../../src/lib/auth/auth-session", () => ({
  establishAuthSession,
  getAuthToken: () => Promise.resolve(undefined),
}));

const { replayDeferredSave } = vi.hoisted(() => ({ replayDeferredSave: vi.fn() }));
vi.mock("../../../src/features/chat/save/complete-deferred-save", () => ({ replayDeferredSave }));

beforeEach(() => { replayDeferredSave.mockResolvedValue("none"); });
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/auth/callback route", () => {
  it("establishes the session and redirects home once a token is obtained", async () => {
    establishAuthSession.mockResolvedValue("jwt-callback");
    const router = getRouter();
    await router.navigate({ to: "/auth/callback" });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(SETTLED_HOME);
    });
  });

  it("returns to a validated relative next target once the session is established (#284 T8)", async () => {
    establishAuthSession.mockResolvedValue("jwt-callback");
    const router = getRouter();
    await router.navigate({ to: "/auth/callback", search: { next: "/chat?settings=byok" } });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/chat");
    });
    expect(router.state.location.search).toEqual(expect.objectContaining({ settings: "byok" }));
  });

  it.each(["https://evil.test/", "//evil.test", "/\\evil.test"])(
    "falls back to / for the T14 vector %j instead of redirecting off-origin",
    async (vector) => {
      establishAuthSession.mockResolvedValue("jwt-callback");
      const router = getRouter();
      await router.navigate({ to: "/auth/callback", search: { next: vector } });
      render(<RouterProvider router={router} />);
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(SETTLED_HOME);
      });
      expect(router.state.location.search).toEqual({});
    },
  );

  it("keeps today's behaviour for an empty next (navigate to /)", async () => {
    establishAuthSession.mockResolvedValue("jwt-callback");
    const router = getRouter();
    await router.navigate({ to: "/auth/callback", search: { next: "   " } });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(SETTLED_HOME);
    });
  });

});

describe("/auth/callback route — Neon session verifier", () => {
  it("keeps the Neon session verifier on the callback URL so the client can redeem it", async () => {
    const router = getRouter();
    establishAuthSession.mockImplementation(() => {
      expect(router.state.location.search).toEqual(
        expect.objectContaining({ neon_auth_session_verifier: "ml-abc" }),
      );
      return Promise.resolve("jwt-callback");
    });
    await router.navigate({
      to: "/auth/callback",
      search: { neon_auth_session_verifier: "ml-abc" },
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(SETTLED_HOME);
    });
  });
});

describe("/auth/callback route — dual intent (#480 P1-2)", () => {
  /**
   * The #514 round-2 gap: `carriesPanelIntent` was pinned as a FUNCTION, but
   * nothing drove it through the route. Widening `callback.tsx` back to the
   * inline `sanitizeReturnTarget(next) !== "/"` left all 1508 unit tests green
   * — the save wall's own return target would have silently retired the retry
   * surface at the wiring layer, which is the exact shape of #507 itself. This
   * pair closes it: a session return HOLDS, a panel return NAVIGATES.
   */
  it("holds the save-retry surface for a plain session return (#507 review P1-1)", async () => {
    setLanguages(["ja"]);
    establishAuthSession.mockResolvedValue("jwt-callback");
    replayDeferredSave.mockResolvedValue("failed");
    const router = getRouter();
    await router.navigate({ to: "/auth/callback", search: { next: "/chat?session=sess-1" } });
    render(<RouterProvider router={router} />);
    const retry = await screen.findByRole("button", { name: dictFor("ja").auth.callback_save_retry });
    expect(retry).toBeTruthy();
    expect(router.state.location.pathname).toBe("/auth/callback");
  });

  it("reaches the BYOK deep link even when the deferred-save replay failed", async () => {
    establishAuthSession.mockResolvedValue("jwt-callback");
    replayDeferredSave.mockResolvedValue("failed");
    const router = getRouter();
    await router.navigate({ to: "/auth/callback", search: { next: "/chat?settings=byok" } });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/chat");
    });
  });
});

describe("/auth/callback route — failure", () => {
  it("shows the SDK error.message and does not redirect when sign-in failed", async () => {
    setLanguages(["ja"]);
    establishAuthSession.mockRejectedValue(new Error("INVALID_TOKEN"));
    const router = getRouter();
    await router.navigate({ to: "/auth/callback" });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("INVALID_TOKEN");
    });
    expect(router.state.location.pathname).toBe("/auth/callback");
  });
});
