/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataPartCard } from "../../../src/features/chat/components/DataPartCard";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);

const dict = chatDictFor("ja");

function renderPart(data: unknown) {
  return render(<DataPartCard data={data} dict={dict} />);
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

describe("DataPartCard error intent", () => {
  it("renders the envelope message and each error detail as an alert", () => {
    renderPart({
      intent: "error",
      message: "モデルに接続できませんでした",
      errors: [
        { code: "provider_unavailable", message: "provider timed out" },
        { code: "retry_exhausted", message: "all retries failed" },
      ],
      data: {},
    });
    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(screen.getByText("モデルに接続できませんでした")).toBeTruthy();
    expect(screen.getByText("provider timed out")).toBeTruthy();
    expect(screen.getByText("all retries failed")).toBeTruthy();
  });

  it("falls back to localized copy when the envelope has no message", () => {
    renderPart({ intent: "error", data: {} });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(dict.errorCard)).toBeTruthy();
  });

  it("keeps the localized fallback out of the card when a message exists", () => {
    renderPart({ intent: "error", message: "接続エラー", data: {} });
    expect(screen.getByText("接続エラー")).toBeTruthy();
    expect(screen.queryByText(dict.errorCard)).toBeNull();
  });
});
