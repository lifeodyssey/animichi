/**
 * @vitest-environment jsdom
 */
import type { ChatStatus, UIMessage } from "ai";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/chat-actions";
import { MessageList } from "../../../src/features/chat/components/MessageList";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { useTurnTiming } from "../../../src/features/chat/use-turn-timing";
import { routePartRaw, ujiPoints } from "./_route-fixtures";

afterEach(cleanup);

const ja = chatDictFor("ja");

function assistantMessage(id: string, data: unknown): UIMessage {
  const part = { type: "data-response", id: "response", data };
  return { id, role: "assistant", parts: [part] as unknown as UIMessage["parts"] };
}

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

/** The real bypass turn as streamed: the `plan_selected` step's tool part
 * (which `chat_stream` always emits — review P1-1) plus the data part. */
function recomputeMessage(id: string, points: readonly Record<string, unknown>[]): UIMessage {
  const tool = {
    type: "tool-plan_selected",
    toolCallId: "plan_selected-fixture",
    state: "output-available",
    input: {},
    output: { point_count: points.length },
  };
  const data = { type: "data-response", id: "response", data: { ...routePartRaw(points), intent: "plan_selected" } };
  return { id, role: "assistant", parts: [tool, data] as unknown as UIMessage["parts"] };
}

function renderList(messages: readonly UIMessage[], status: ChatStatus = "ready") {
  return render(
    <ChatActionsProvider actions={{ send: vi.fn(), regenerate: vi.fn() }}>
      <MessageList messages={messages} dict={ja} status={status} />
    </ChatActionsProvider>,
  );
}

function ClockHarness({ status }: Readonly<{ status: ChatStatus }>) {
  const settled = useTurnTiming(status, () => undefined);
  return (
    <ChatActionsProvider actions={{ send: vi.fn(), regenerate: vi.fn() }}>
      <MessageList messages={[recomputeMessage("a1", ujiPoints().slice())]} dict={ja} status={status} settledDurationMs={settled} />
    </ChatActionsProvider>
  );
}

describe("AC: the settled 再計算 footprint reads an injected, mocked clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders exactly 「✓ 再計算 1.2s」 after the fake clock advances 1200ms", () => {
    const { rerender } = render(<ClockHarness status="ready" />);
    rerender(<ClockHarness status="submitted" />);
    vi.advanceTimersByTime(1200);
    rerender(<ClockHarness status="ready" />);
    const footprint = document.querySelector(".chat-settled--recompute");
    expect(footprint?.textContent).toBe("✓ 再計算 1.2s");
  });

  it("renders no footprint while the recompute turn is still active", () => {
    const { rerender } = render(<ClockHarness status="ready" />);
    rerender(<ClockHarness status="submitted" />);
    vi.advanceTimersByTime(500);
    rerender(<ClockHarness status="streaming" />);
    expect(document.querySelector(".chat-settled--recompute")).toBeNull();
  });
});

describe("AC: the bypass renders no tool pipeline (no agent, no agent theater)", () => {
  it("shows the recompute footprint and zero step badges for a plan_selected turn", () => {
    renderList([recomputeMessage("a1", ujiPoints().slice())]);
    expect(document.querySelector(".chat-settled--recompute")).not.toBeNull();
    expect(document.querySelector(".chat-step")).toBeNull();
  });

  it("keeps the footprint off agent-path route cards", () => {
    renderList([assistantMessage("a1", routePartRaw(ujiPoints().slice()))]);
    expect(document.querySelector(".chat-settled--recompute")).toBeNull();
  });
});

function routeCards(): readonly Element[] {
  return [...document.querySelectorAll("article[data-intent]")];
}

describe("AC multi-turn: follow-up plus recompute keep every version in order", () => {
  it("renders three versions ascending with exactly the newest un-superseded", () => {
    renderList([
      userMessage("u1", "ユーフォ"),
      assistantMessage("a1", routePartRaw(ujiPoints().slice())),
      userMessage("u2", "図書館は外して"),
      assistantMessage("a2", routePartRaw(ujiPoints().slice(0, 2))),
      recomputeMessage("a3", ujiPoints().slice(1)),
    ]);
    const cards = routeCards();
    expect(cards.map((card) => card.getAttribute("data-intent"))).toEqual([
      "plan_route",
      "plan_route",
      "plan_selected",
    ]);
    expect(cards.map((card) => card.className.includes("chat-card--superseded"))).toEqual([true, true, false]);
  });

  it("appends the recompute card via the existing supersededFlags, badge on the prior card", () => {
    renderList([
      assistantMessage("a1", routePartRaw(ujiPoints().slice())),
      recomputeMessage("a2", ujiPoints().slice(0, 2)),
    ]);
    const [oldCard, newCard] = routeCards();
    expect(oldCard?.className).toBe("chat-card chat-card--superseded");
    expect(oldCard?.querySelector(".chat-card__version-badge")?.textContent).toBe(ja.previousVersion);
    expect(newCard?.className).toBe("chat-card");
  });
});
