/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStatus } from "../../../src/lib/auth/session";
import { server } from "../../msw/node";
import { popularEmptyHandler } from "../../msw/popular";
import { usersRoutesEmptyHandler } from "../../msw/users";
import { setLanguages } from "../_i18n";
import { renderHome } from "./_render";

let mockStatus: AuthStatus = "anonymous";
vi.mock("../../../src/lib/auth/session", () => ({ useAuthStatus: () => mockStatus }));
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));

const { HomeView, HomeRoute } = await import("../../../src/routes/index");

beforeEach(() => {
  setLanguages(["ja-JP"]);
  server.use(popularEmptyHandler, usersRoutesEmptyHandler);
});
afterEach(cleanup);

describe("root route dual state", () => {
  it("renders the marketing Landing for an anonymous visitor", () => {
    mockStatus = "anonymous";
    renderHome(<HomeView />);
    expect(screen.getByText("アニメ旅行ジャーナル")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("renders the App Home for an authenticated user and navigates on search", async () => {
    mockStatus = "authenticated";
    renderHome(<HomeView />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Suzume" } });
    fireEvent.click(screen.getByRole("button", { name: "ルートを作る" }));
    await waitFor(() => { expect(screen.getByText("人気ランキング")).toBeTruthy(); });
  });

  it("wraps the view in the locale provider via HomeRoute", () => {
    mockStatus = "anonymous";
    renderHome(<HomeRoute />);
    expect(screen.getByText("アニメ旅行ジャーナル")).toBeTruthy();
  });
});
