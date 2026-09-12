/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { server } from "../../msw/node";
import { chatRecomputeHandler, chatStreamPatchedHandler, searchResultsPatch } from "../../msw/chat-handlers";
import { chatSearch, renderChatPage } from "./_chat-page";

type SentBody = Readonly<{ selected_point_ids?: readonly string[]; messages?: readonly Readonly<{ role: string; parts: readonly Readonly<{ type: string; text?: string }>[] }>[] }>;
const dict = chatDictFor("ja");
beforeEach(() => { setLanguages(["ja"]); });

describe("search result automatic planning", () => {
  it("sends a real follow-up about these candidates with no selected-point override", async () => {
    const bodies: SentBody[] = [];
    const spy = (request: Request) => { void request.clone().json().then((body: SentBody) => bodies.push(body)); };
    server.use(chatRecomputeHandler({ spy }));
    server.use(chatStreamPatchedHandler("search", searchResultsPatch, { spy, once: true }));
    renderChatPage(chatSearch({ q: "ユーフォ" }));
    const arrange = await screen.findByRole<HTMLButtonElement>("button", { name: dict.search.arrange });
    await waitFor(() => { expect(arrange.disabled).toBe(false); });
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
    fireEvent.click(arrange);
    await waitFor(() => { expect(bodies).toHaveLength(2); });
    expect(bodies[1]?.selected_point_ids).toBeUndefined();
    const turn = bodies[1]?.messages?.at(-1);
    expect(turn?.role).toBe("user");
    const text = turn?.parts.find((part) => part.type === "text")?.text;
    expect(text).toContain("宇治橋");
    expect(text).toContain("宇治神社");
  });
});
