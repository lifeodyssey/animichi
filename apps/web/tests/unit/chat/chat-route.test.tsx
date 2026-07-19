/**
 * @vitest-environment jsdom
 */
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { getRouter } from "../../../src/router";
import { setLanguages } from "../_i18n";
import { server } from "../../msw/node";
import { healthzOkHandler } from "../../msw/chat-handlers";

afterEach(cleanup);

// jsdom does not implement scrollIntoView; the chat anchor effect needs a stub.
Element.prototype.scrollIntoView = () => undefined;

describe("/chat route", () => {
  it("resolves the file route and renders the A1 cold start", async () => {
    setLanguages(["ja"]);
    server.use(healthzOkHandler);
    const router = getRouter();
    await router.navigate({ to: "/chat" });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/chat");
    });
    expect(await screen.findByText(chatDictFor("ja").greeting)).toBeTruthy();
  });

  it("validates search params through parseChatSearch", async () => {
    server.use(healthzOkHandler);
    const router = getRouter();
    await router.navigate({ to: "/chat", search: { session: "s-9" } });
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ session: "s-9" });
    });
  });
});
