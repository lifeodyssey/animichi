/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { emptyTravelConditions } from "../../../src/features/chat/lib/trip-conditions";
import { ConditionsFixture } from "./trip-conditions-fixture";

afterEach(cleanup);

describe("reviewing existing trip conditions", () => {
  it("submits all known facts without presenting the same questions again", () => {
    const onContinue = vi.fn();
    const value = { origin: "四谷站", availableTime: "半天", departureTime: "明天上午" };
    render(<ConditionsFixture value={value} onContinue={onContinue} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "半天" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "生成行程建议" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith(value);
  });

  it("opens a known free-form budget for editing without changing its value", () => {
    const onContinue = vi.fn();
    const value = { origin: "四谷站", availableTime: "午饭前，约 2 小时", departureTime: "" };
    render(<ConditionsFixture value={value} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "修改: 可以逛多久" }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "可以逛多久" }).value).toBe(value.availableTime);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "可以逛多久" }));
    fireEvent.click(screen.getByRole("button", { name: "一天" }));
    expect(screen.queryByRole("textbox", { name: "可以逛多久" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "生成行程建议" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith({ ...value, availableTime: "一天" });
  });

  it("returns keyboard focus to choices when editing a known preset", () => {
    render(<ConditionsFixture value={{ ...emptyTravelConditions, availableTime: "半天" }} />);
    fireEvent.click(screen.getByRole("button", { name: "修改: 可以逛多久" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "半天" }));
  });

  it("blocks duplicate submission and changes while preparing a suggestion", () => {
    const onContinue = vi.fn();
    render(<ConditionsFixture busy onContinue={onContinue} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "半天" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "出发地" }).disabled).toBe(true);
    const action = screen.getByRole<HTMLButtonElement>("button", { name: "正在整理建议…" });
    expect(action.disabled).toBe(true);
    expect(action.getAttribute("aria-busy")).toBe("true");
    fireEvent.submit(screen.getByRole("form", { name: "这次想怎么逛？" }));
    expect(onContinue).not.toHaveBeenCalled();
  });
});

describe("localized condition prompts", () => {
  it("keeps a selected time visible when the interface language changes", () => {
    const { rerender } = render(<ConditionsFixture />);
    fireEvent.click(screen.getByRole("button", { name: "半天" }));
    rerender(<ConditionsFixture dict={chatDictFor("en")} />);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Time to explore" }).value).toBe("半天");
  });

  it("uses English controls and preserves an unstructured place name", () => {
    const onContinue = vi.fn();
    render(<ConditionsFixture dict={chatDictFor("en")} onContinue={onContinue} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Starting point" }), { target: { value: "My hotel" } });
    fireEvent.click(screen.getByRole("button", { name: "Full day" }));
    fireEvent.click(screen.getByRole("button", { name: "Suggest an itinerary" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith({ origin: "My hotel", availableTime: "Full day", departureTime: "" });
  });

  it("offers a first draft in Japanese with no required facts", () => {
    const onContinue = vi.fn();
    render(<ConditionsFixture dict={chatDictFor("ja")} onContinue={onContinue} />);
    expect(screen.getByRole("heading", { name: "どんなふうに巡る？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "まずは案を見てみる" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith(emptyTravelConditions);
  });
});

describe("clearing existing details", () => {
  it("keeps the start-time editor focused when a known value is cleared", () => {
    const onContinue = vi.fn();
    render(<ConditionsFixture value={{ ...emptyTravelConditions, departureTime: "明天" }} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "修改: 出发时间" }));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "出发时间" });
    fireEvent.change(input, { target: { value: "" } });
    expect(document.activeElement).toBe(input);
    expect(input.isConnected).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "先给一版建议" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith(emptyTravelConditions);
  });
});
