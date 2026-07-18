/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataPartCard } from "../../../src/features/chat/components/DataPartCard";
import { chatDictFor } from "../../../src/features/chat/i18n";

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
