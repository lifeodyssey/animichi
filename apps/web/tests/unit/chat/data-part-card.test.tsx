/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/chat-actions";
import { DataPartCard } from "../../../src/features/chat/components/DataPartCard";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);

const dict = chatDictFor("ja");

function renderPart(data: unknown) {
  return render(
    <ChatActionsProvider actions={{ send: vi.fn(), regenerate: vi.fn() }}>
      <DataPartCard data={data} dict={dict} />
    </ChatActionsProvider>,
  );
}

describe("DataPartCard", () => {
  it("renders a skeleton card for the intent-first frame", () => {
    renderPart({ intent: "plan_route" });
    const skeleton = screen.getByRole("status");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    expect(skeleton.getAttribute("data-intent")).toBe("plan_route");
  });

  it("renders the full route card when the same-ID overwrite arrives", () => {
    renderPart({
      intent: "plan_route",
      message: "宇治の聖地を2件、徒歩ルートにまとめました。",
      data: {
        results: { rows: [{ id: "p1", name: "宇治橋" }, { id: "p2", name: "京阪宇治駅" }] },
        route: { point_count: 2, total_walk_minutes: 12 },
      },
    });
    expect(screen.getByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeTruthy();
    expect(screen.getByText("宇治橋")).toBeTruthy();
    expect(screen.getByText(/12/)).toBeTruthy();
  });

  it("appends the D3 short-route notice while keeping the spot cards", () => {
    renderPart({
      intent: "plan_route",
      data: { route: { ordered_points: [{ id: "p1", name: "宇治橋" }], point_count: 1 } },
    });
    expect(screen.getByText("宇治橋")).toBeTruthy();
    expect(screen.getByText(dict.errorStates.d3Notice)).toBeTruthy();
  });

  it("renders clarify candidates as options", () => {
    renderPart({
      intent: "clarify",
      message: "どの作品でしょうか?",
      data: { candidates: [{ id: "1", title: "涼宮ハルヒの憂鬱" }] },
    });
    expect(screen.getByText("涼宮ハルヒの憂鬱")).toBeTruthy();
  });

  it("falls back on an invalid data part instead of crashing", () => {
    renderPart({ intent: "hack", data: { evil: true } });
    expect(screen.getByText(dict.fallbackCard)).toBeTruthy();
  });

  it("renders prose intents as message only", () => {
    renderPart({ intent: "greet_user", message: "こんにちは!" });
    expect(screen.getByText("こんにちは!")).toBeTruthy();
  });
});

describe("DataPartCard intent bodies", () => {
  it("renders the search card with the resolved title and rows", () => {
    renderPart({
      intent: "search_bangumi",
      message: "2件みつけたよ",
      data: { results: { title: "響け!ユーフォニアム", rows: [{ id: "p1", name: "宇治橋" }] } },
    });
    expect(screen.getByText("響け!ユーフォニアム")).toBeTruthy();
    expect(screen.getByText("宇治橋")).toBeTruthy();
  });

  it("renders a route card without route data or rows gracefully", () => {
    renderPart({ intent: "plan_route", message: "けいかくちゅう", data: {} });
    expect(screen.getByText("けいかくちゅう")).toBeTruthy();
    expect(document.querySelector(".chat-card__stats")).toBeNull();
    expect(document.querySelector(".chat-card__spots")).toBeNull();
  });

  it("renders clarify without candidates as an empty option list", () => {
    renderPart({ intent: "clarify", message: "どれ?", data: {} });
    expect(screen.getByText("どれ?")).toBeTruthy();
  });
});

describe("DataPartCard failed envelopes", () => {
  it("renders the D6 apology instead of the raw error details", () => {
    renderPart({
      intent: "error",
      message: "モデルに接続できませんでした",
      errors: [
        { code: "retry_exhausted", message: "ModelRetry exhausted after output_validator rejection" },
      ],
      data: {},
    });
    expect(screen.getByRole("alert").textContent).toContain(dict.errorStates.d6Message);
    expect(screen.queryByText(/ModelRetry/)).toBeNull();
    expect(screen.queryByText("モデルに接続できませんでした")).toBeNull();
  });

  it("routes a not-found failure onto the D1 recognition fallback", () => {
    renderPart({
      intent: "error",
      errors: [{ code: "anime_not_found", message: "resolver miss" }],
      data: {},
    });
    expect(screen.getByText(dict.errorStates.d1Title)).toBeTruthy();
    expect(screen.queryByText("resolver miss")).toBeNull();
  });

  it("routes an empty search result onto the D2 no-spots fallback", () => {
    renderPart({ intent: "search_bangumi", data: { results: { rows: [] } } });
    expect(screen.getByText(dict.errorStates.d2Title)).toBeTruthy();
  });

  it("renders a failed clarify as candidates, not the D6 dead-loop apology", () => {
    renderPart({
      intent: "clarify",
      success: false,
      status: "invalid_selection",
      message: "どの作品でしょうか?",
      data: { candidates: [{ id: "1", title: "涼宮ハルヒの憂鬱" }] },
    });
    expect(screen.getByText("涼宮ハルヒの憂鬱")).toBeTruthy();
    expect(screen.queryByText(dict.errorStates.d6Message)).toBeNull();
  });
});
