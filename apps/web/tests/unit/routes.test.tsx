/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getRouter } from "../../src/router";
import { Route as RootRoute } from "../../src/routes/__root";

describe("route tree rendering", () => {
  it("mounts the root document shell and resolves the index route", async () => {
    const router = getRouter();
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(router.state.matches.some((match) => match.routeId === "/")).toBe(true);
  });

  it("renders the branded 404 through the root not-found boundary", () => {
    const renderNotFound = RootRoute.options.notFoundComponent as () => ReactNode;
    render(<>{renderNotFound()}</>);
    expect(screen.getByRole("heading", { name: "404" })).toBeTruthy();
  });
});
