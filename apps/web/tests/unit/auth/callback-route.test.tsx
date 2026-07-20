/**
 * @vitest-environment jsdom
 */
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRouter } from "../../../src/router";
import { setLanguages } from "../_i18n";
import { dictFor } from "../../../src/i18n/dictionaries";

const { getAuthToken } = vi.hoisted(() => ({ getAuthToken: vi.fn() }));
vi.mock("../../../src/lib/auth/authSession", () => ({ getAuthToken }));

const { replayDeferredSave } = vi.hoisted(() => ({ replayDeferredSave: vi.fn() }));
vi.mock("../../../src/features/chat/save/createOnLogin", () => ({ replayDeferredSave }));

beforeEach(() => { replayDeferredSave.mockResolvedValue("none"); });
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/auth/callback route", () => {
  it("establishes the session and redirects home once a token is obtained", async () => {
    getAuthToken.mockResolvedValue("jwt-callback");
    const router = getRouter();
    await router.navigate({ to: "/auth/callback" });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });

  it("returns to a validated relative next target once the session is established (#284 T8)", async () => {
    getAuthToken.mockResolvedValue("jwt-callback");
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
      getAuthToken.mockResolvedValue("jwt-callback");
      const router = getRouter();
      await router.navigate({ to: "/auth/callback", search: { next: vector } });
      render(<RouterProvider router={router} />);
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/");
      });
    },
  );

  it("keeps today's behaviour for an empty next (navigate to /)", async () => {
    getAuthToken.mockResolvedValue("jwt-callback");
    const router = getRouter();
    await router.navigate({ to: "/auth/callback", search: { next: "   " } });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
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
    getAuthToken.mockResolvedValue("jwt-callback");
    replayDeferredSave.mockResolvedValue("failed");
    const router = getRouter();
    await router.navigate({ to: "/auth/callback", search: { next: "/chat?session=sess-1" } });
    render(<RouterProvider router={router} />);
    const retry = await screen.findByRole("button", { name: dictFor("ja").auth.callback_save_retry });
    expect(retry).toBeTruthy();
    expect(router.state.location.pathname).toBe("/auth/callback");
  });

  it("reaches the BYOK deep link even when the deferred-save replay failed", async () => {
    getAuthToken.mockResolvedValue("jwt-callback");
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
  it("shows an on-brand error and does not redirect when no session was established", async () => {
    setLanguages(["ja"]);
    getAuthToken.mockResolvedValue(undefined);
    const router = getRouter();
    await router.navigate({ to: "/auth/callback" });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(router.state.location.pathname).toBe("/auth/callback");
  });
});
