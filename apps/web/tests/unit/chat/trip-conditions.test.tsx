/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyTravelConditions } from "../../../src/features/chat/lib/trip-conditions";
import { ConditionsFixture } from "./trip-conditions-fixture";

afterEach(cleanup);

describe("conditions for a first itinerary suggestion", () => {
  it("continues with undecided facts without inventing a station or time", () => {
    const onContinue = vi.fn();
    render(<ConditionsFixture onContinue={onContinue} />);
    expect(screen.queryByRole("textbox", { name: "出发时间" })).toBeNull();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "先给一版建议" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith(emptyTravelConditions);
  });

  it("keeps known facts visible and only asks for the missing time budget", () => {
    const onContinue = vi.fn();
    const value = { ...emptyTravelConditions, origin: "四谷站", departureTime: "明天上午 10 点" };
    render(<ConditionsFixture value={value} onContinue={onContinue} />);
    expect(screen.getByText(value.origin)).toBeTruthy();
    expect(screen.getByText(value.departureTime)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "半天" }));
    expect(screen.getByRole("button", { name: "半天" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "生成行程建议" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith({ ...value, availableTime: "半天" });
  });

  it("edits a known departure in place and preserves both time facts", () => {
    const onContinue = vi.fn();
    const value = { origin: "四谷站", availableTime: "3 小时", departureTime: "周六上午" };
    render(<ConditionsFixture value={value} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "修改: 出发地" }));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "出发地" });
    expect(input.value).toBe("四谷站");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "  新宿站  " } });
    fireEvent.click(screen.getByRole("button", { name: "生成行程建议" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith({ ...value, origin: "新宿站" });
  });
});

describe("optional details and flexible time budgets", () => {
  it("can toggle a preset off and continue with time undecided", () => {
    const onContinue = vi.fn();
    render(<ConditionsFixture value={{ ...emptyTravelConditions, origin: "四谷站" }} onContinue={onContinue} />);
    const halfDay = screen.getByRole("button", { name: "半天" });
    fireEvent.click(halfDay);
    fireEvent.click(halfDay);
    expect(halfDay.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "先给一版建议" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith({ ...emptyTravelConditions, origin: "四谷站" });
  });

  it("accepts free-form time instead of forcing a half-day or full-day budget", () => {
    const onContinue = vi.fn();
    render(<ConditionsFixture onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "自己填" }));
    const input = screen.getByRole("textbox", { name: "可以逛多久" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "  下午两点前  " } });
    fireEvent.click(screen.getByRole("button", { name: "先给一版建议" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith({ ...emptyTravelConditions, availableTime: "下午两点前" });
  });

  it("adds a start time on request and retains it with an unknown departure", () => {
    const onContinue = vi.fn();
    render(<ConditionsFixture onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "加上出发时间" }));
    const input = screen.getByRole("textbox", { name: "出发时间" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "周日午饭后" } });
    fireEvent.click(screen.getByRole("button", { name: "先给一版建议" }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith({ ...emptyTravelConditions, departureTime: "周日午饭后" });
  });
});
