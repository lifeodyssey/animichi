/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { server } from "../../msw/node";
import {
  chatHttpErrorHandler,
  chatRecomputeControlledHandler,
  chatRecomputeHandler,
  chatStreamHeldOpenHandler,
  chatStreamPatchedHandler,
  searchResultsPatch,
} from "../../msw/chat-handlers";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

interface SentPart {
  readonly type: string;
  readonly text?: string;
}

interface SentMessage {
  readonly role: string;
  readonly parts: readonly SentPart[];
}

interface SentBody {
  readonly selected_point_ids?: readonly string[];
  readonly messages?: readonly SentMessage[];
}

/** A genuine user turn carries a non-empty text part; markers carry none. */
function userTurns(body?: SentBody): number {
  const spoken = (message: SentMessage) =>
    message.role === "user" && message.parts.some((part) => part.type === "text" && part.text !== "");
  return (body?.messages ?? []).filter(spoken).length;
}

beforeEach(() => {
  setLanguages(["ja"]);
});

async function searchThenTickTwo(bodies: SentBody[]): Promise<void> {
  const spy = (request: Request) => {
    void request.clone().json().then((body: SentBody) => bodies.push(body));
  };
  server.use(chatRecomputeHandler({ spy }));
  server.use(chatStreamPatchedHandler("search", searchResultsPatch, { spy, once: true }));
  renderChatPage(chatSearch({ q: "ユーフォ" }));
  await screen.findByText("宇治橋");
  fireEvent.click(screen.getByRole("checkbox", { name: `${ja.search.select}: 宇治橋` }));
  fireEvent.click(screen.getByRole("checkbox", { name: `${ja.search.select}: 宇治神社` }));
}

function recomputeNow(): void {
  fireEvent.click(screen.getByRole("button", { name: ja.search.trayAction }));
}

describe("AC: the tray action drives the selected_point_ids bypass", () => {
  it("issues exactly one extra POST whose body carries the ticked ids and no new user turn", async () => {
    const bodies: SentBody[] = [];
    await searchThenTickTwo(bodies);
    recomputeNow();
    await waitFor(() => {
      expect(document.querySelector('article[data-intent="plan_selected"]')).toBeTruthy();
    });
    // The spy decodes bodies asynchronously — wait, don't race (#461 review).
    await waitFor(() => {
      expect(bodies).toHaveLength(2);
    });
    const [search, recompute] = bodies;
    expect(search?.selected_point_ids).toBeUndefined();
    expect(recompute?.selected_point_ids).toEqual(["p1", "p3"]);
    expect(userTurns(recompute)).toBe(userTurns(search));
    // The wire shape Task 3's persistence skip keys on: a part-less user marker.
    const marker = recompute?.messages?.at(-1);
    expect(marker?.role).toBe("user");
    expect(marker?.parts).toEqual([]);
  });

  it("renders the recompute as footprint + card, with no tool badges and the old card dimmed", async () => {
    const bodies: SentBody[] = [];
    await searchThenTickTwo(bodies);
    recomputeNow();
    await waitFor(() => {
      expect(document.querySelector(".chat-settled--recompute")).toBeTruthy();
    });
    const recomputeTurn = document.querySelector('article[data-intent="plan_selected"]');
    expect(recomputeTurn?.className).toBe("chat-card");
    expect(recomputeTurn?.closest("li")?.querySelector(".chat-step")).toBeNull();
    expect(document.querySelector('article[data-intent="search_bangumi"]')?.className).toBe("chat-card");
  });
});

describe("P1-3: no concurrent turns from the tray", () => {
  it("hides the tray while any turn is streaming, so it cannot fire mid-stream", async () => {
    const bodies: SentBody[] = [];
    await searchThenTickTwo(bodies);
    expect(document.querySelector(".chat-selection-tray")).toBeTruthy();
    server.use(chatStreamHeldOpenHandler("search"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "図書館は外して" } });
    fireEvent.click(screen.getByRole("button", { name: ja.send }));
    await waitFor(() => {
      expect(document.querySelector(".chat-selection-tray")).toBeNull();
    });
    expect(screen.queryByRole("button", { name: ja.search.trayAction })).toBeNull();
  });
});

describe("P2-6: the recompute skeleton state actually appears", () => {
  it("shows the plan_selected skeleton until the final envelope lands", async () => {
    const bodies: SentBody[] = [];
    await searchThenTickTwo(bodies);
    const controlled = chatRecomputeControlledHandler();
    server.use(controlled.handler);
    recomputeNow();
    await waitFor(() => {
      expect(document.querySelector('.chat-card--skeleton[data-intent="plan_selected"]')).toBeTruthy();
    });
    controlled.releaseFinal();
    await waitFor(() => {
      expect(document.querySelector('article[data-intent="plan_selected"]')).toBeTruthy();
    });
    expect(document.querySelector('.chat-card--skeleton[data-intent="plan_selected"]')).toBeNull();
  });
});

describe("AC error path: a failed recompute stays on the tray", () => {
  it("shows the inline retry, keeps the selection and the old card, and skips TurnFailure", async () => {
    const bodies: SentBody[] = [];
    await searchThenTickTwo(bodies);
    server.use(chatHttpErrorHandler(500));
    recomputeNow();
    const retry = await screen.findByRole("button", { name: ja.search.trayRetry });
    expect(retry).toBeTruthy();
    expect(screen.queryByText(ja.errorStates.d4Message)).toBeNull();
    expect(screen.getByText("宇治橋")).toBeTruthy();
    const checked = screen.getAllByRole<HTMLInputElement>("checkbox").filter((box) => box.checked);
    expect(checked).toHaveLength(2);
  });

  it("recovers when the tray retry succeeds", async () => {
    const bodies: SentBody[] = [];
    await searchThenTickTwo(bodies);
    server.use(chatHttpErrorHandler(500));
    recomputeNow();
    await screen.findByRole("button", { name: ja.search.trayRetry });
    server.use(chatRecomputeHandler());
    fireEvent.click(screen.getByRole("button", { name: ja.search.trayRetry }));
    await waitFor(() => {
      expect(document.querySelector('article[data-intent="plan_selected"]')).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: ja.search.trayRetry })).toBeNull();
  });
});
