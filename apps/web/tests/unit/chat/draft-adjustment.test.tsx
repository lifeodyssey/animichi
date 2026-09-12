/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { draftAdjustmentCopy } from "../../../src/features/chat/draft-adjustment-copy";
import { emptyTravelConditions } from "../../../src/features/chat/lib/trip-conditions";
import { draftFixture } from "./itinerary-draft-fixture";
import { AdjustmentFixture } from "./draft-adjustment-fixture";

afterEach(cleanup);

describe("a request against the current itinerary", () => {
  it("shows known context without turning model assumptions into facts", () => {
    render(<AdjustmentFixture draft={{ ...draftFixture, conditions: emptyTravelConditions, assumptions: ["先假设上午从四谷站出发"] }} />);
    const context = within(screen.getByRole("region", { name: "东京半日巡礼" }));
    expect(context.getByText("东京半日巡礼")).toBeTruthy();
    expect(context.getByText("2 个地点")).toBeTruthy();
    expect(context.queryByText("出发地")).toBeNull();
    expect(within(screen.getByRole("complementary", { name: "这版先按这些来安排" })).getByText("先假设上午从四谷站出发")).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });

  it("appends editable suggestions without overwriting text or sending", () => {
    const onSubmit = vi.fn();
    render(<AdjustmentFixture onSubmit={onSubmit} value="下午从新宿站出发。" />);
    fireEvent.click(screen.getByRole("button", { name: "轻松一点" }));
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "调整想法" });
    expect(input.value).toBe("下午从新宿站出发。\n想逛得轻松一点，多留些时间拍照。");
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "轻松一点" }).disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends the visible version and trimmed request without clearing or mutating the plan", () => {
    const onSubmit = vi.fn();
    const source = JSON.stringify(draftFixture);
    const current = { ...draftFixture, id: "draft-b" };
    render(<AdjustmentFixture draft={current} onSubmit={onSubmit} value={"  下午从新宿站出发。\n多留点时间拍照。  "} />);
    fireEvent.click(screen.getByRole("button", { name: "更新草案" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ draftId: "draft-b", instruction: "下午从新宿站出发。\n多留点时间拍照。", places: current.stops.map((stop) => stop.place) });
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("  下午从新宿站出发。\n多留点时间拍照。  ");
    expect(JSON.stringify(draftFixture)).toBe(source);
  });
});

describe("recoverable adjustment states", () => {
  it("does not send a blank or whitespace-only request", () => {
    const onSubmit = vi.fn();
    render(<AdjustmentFixture onSubmit={onSubmit} value={" \n "} />);
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "更新草案" });
    expect(button.disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "还有想调整的吗？" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps pending input readable, rejects duplicate sends and permits return", () => {
    const onSubmit = vi.fn();
    const onBack = vi.fn();
    render(<AdjustmentFixture status="updating" value="晚一点出发" onSubmit={onSubmit} onBack={onBack} />);
    const input = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(input.value).toBe("晚一点出发");
    expect(input.readOnly).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "正在调整…" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "晚点出发" }).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "还有想调整的吗？" }));
    fireEvent.click(screen.getByRole("button", { name: "查看原草案" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledExactlyOnceWith("draft-a");
    expect(input.value).toBe("晚一点出发");
  });

  it("retains the request through pending and failure, then retries an edited request", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<AdjustmentFixture onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "下午出发" } });
    rerender(<AdjustmentFixture onSubmit={onSubmit} status="updating" />);
    rerender(<AdjustmentFixture onSubmit={onSubmit} status="failed" />);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("下午出发");
    expect(screen.getByRole("status").textContent).toContain("原草案都还在");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "下午两点出发" } });
    fireEvent.click(screen.getByRole("button", { name: "再试一次" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ draftId: "draft-a", instruction: "下午两点出发", places: draftFixture.stops.map((stop) => stop.place) });
  });
});

describe("localized adjustment", () => {
  it.each(["en", "ja"] as const)("localizes controls and keeps typed text across a switch to %s", (locale) => {
    const { rerender } = render(<AdjustmentFixture value="下午出发" />);
    rerender(<AdjustmentFixture dict={chatDictFor(locale)} />);
    const copy = draftAdjustmentCopy(locale);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: copy.input }).value).toBe("下午出发");
    expect(screen.getByRole("button", { name: copy.submit })).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.back })).toBeTruthy();
  });
});
