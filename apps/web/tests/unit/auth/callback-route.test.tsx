/**
 * @vitest-environment jsdom
 */
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRouter } from "../../../src/router";
import { setLanguages } from "../_i18n";

const { getAuthToken } = vi.hoisted(() => ({ getAuthToken: vi.fn() }));
vi.mock("../../../src/lib/auth/authSession", () => ({ getAuthToken }));

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
