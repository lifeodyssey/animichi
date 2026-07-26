/**
 * @vitest-environment jsdom
 */
import type { UIMessage } from "ai";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/chat-actions";
import { MessageList } from "../../../src/features/chat/components/MessageList";
import { chatDictFor } from "../../../src/features/chat/i18n";
import chatCss from "../../../src/styles/chat.css?raw";
import { ruleDeclaration } from "../_token-helpers";
import { routePartRaw, ujiPoints } from "./_route-fixtures";

afterEach(cleanup);

const ja = chatDictFor("ja");

function assistantMessage(id: string, data: unknown): UIMessage {
  const part = { type: "data-response", id: "response", data };
  return { id, role: "assistant", parts: [part] as unknown as UIMessage["parts"] };
}

function renderList(messages: readonly UIMessage[]) {
  return render(
    <ChatActionsProvider actions={{ send: vi.fn(), regenerate: vi.fn() }}>
      <MessageList messages={messages} dict={ja} status="ready" />
    </ChatActionsProvider>,
  );
}

function routeCards(): readonly Element[] {
  return [...document.querySelectorAll('article[data-intent="plan_route"]')];
}

describe("AC7: regenerating the route replaces the card per the E1 rule", () => {
  it("dims the old card with the previous-version badge and keeps the new one last", () => {
    renderList([
      assistantMessage("a1", routePartRaw(ujiPoints().slice())),
      assistantMessage("a2", routePartRaw(ujiPoints().slice(0, 3))),
    ]);
    const [oldCard, newCard] = routeCards();
    expect(oldCard?.className).toBe("chat-card chat-card--superseded");
    expect(oldCard?.querySelector(".chat-card__version-badge")?.textContent).toBe(ja.previousVersion);
    expect(newCard?.className).toBe("chat-card");
    expect(newCard?.querySelector(".chat-card__version-badge")).toBeNull();
  });

  it("dims every older version once a third regeneration lands", () => {
    renderList([
      assistantMessage("a1", routePartRaw(ujiPoints().slice())),
      assistantMessage("a2", routePartRaw(ujiPoints().slice())),
      assistantMessage("a3", routePartRaw(ujiPoints().slice())),
    ]);
    const flags = routeCards().map((card) => card.className.includes("chat-card--superseded"));
    expect(flags).toEqual([true, true, false]);
  });

  it("pins the E1 dim to opacity .55 in the stylesheet", () => {
    expect(ruleDeclaration(chatCss, ".chat-card--superseded", "opacity")).toBe("0.55");
  });
});

describe("E1 scoping: only newer versions of the same document supersede", () => {
  it("never dims the route card for an unrelated later search card", () => {
    const search = { intent: "search_bangumi", success: true, status: "ok", data: { results: { rows: [{ id: "p1", name: "宇治橋" }] } } };
    renderList([
      assistantMessage("a1", routePartRaw(ujiPoints().slice())),
      assistantMessage("a2", search),
    ]);
    expect(routeCards()[0]?.className).toBe("chat-card");
  });

  it("keeps the old card current while the regenerated route is still a skeleton", () => {
    renderList([
      assistantMessage("a1", routePartRaw(ujiPoints().slice())),
      assistantMessage("a2", { intent: "plan_route" }),
    ]);
    expect(routeCards()[0]?.className).toBe("chat-card");
    expect(screen.getByRole("status").getAttribute("data-intent")).toBe("plan_route");
  });
});
