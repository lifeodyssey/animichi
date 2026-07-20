/**
 * @vitest-environment jsdom
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContinueFromCard } from "../../../src/components/home/ContinueFromCard";
import { server } from "../../msw/node";
import {
  draftRoute,
  usersRoutesEmptyHandler,
  usersRoutesUnauthorizedHandler,
  usersRoutesWithDraftHandler,
} from "../../msw/users";
import { setLanguages } from "../_i18n";
import { renderHome } from "./_render";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("ContinueFromCard", () => {
  it("shows the in-progress route with a resume link when one exists", async () => {
    server.use(usersRoutesWithDraftHandler);
    renderHome(<ContinueFromCard />);
    expect(await screen.findByText(draftRoute.title)).toBeTruthy();
    expect(screen.getByRole("link", { name: "再開する" }).getAttribute("href")).toBe(`/chat?route=${draftRoute.id}`);
  });

  it("renders nothing for a logged-out (unauthorized) caller", async () => {
    server.use(usersRoutesUnauthorizedHandler);
    renderHome(<ContinueFromCard />);
    await waitFor(() => { expect(screen.queryByText("続きから")).toBeNull(); });
  });

  it("renders nothing for a signed-in user with no in-progress route", async () => {
    server.use(usersRoutesEmptyHandler);
    renderHome(<ContinueFromCard />);
    await waitFor(() => { expect(screen.queryByText("続きから")).toBeNull(); });
  });
});
