/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionSummary } from "../../../src/features/chat/components/SelectionSummary";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);
const props = { placeCount: 8, dict: chatDictFor("zh"), onReview: vi.fn(), onContinue: vi.fn() };

describe("selected-place summary actions", () => {
  it("reviews the current selection without submitting a plan", () => {
    const onReview = vi.fn();
    const onContinue = vi.fn();
    render(<SelectionSummary {...props} onReview={onReview} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "查看所选" }));
    expect(onReview).toHaveBeenCalledOnce();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("can continue with one place without imposing the old route minimum", () => {
    const onContinue = vi.fn();
    render(<SelectionSummary {...props} placeCount={1} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "继续规划" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("keeps an empty footer visible but disables both selection actions", () => {
    render(<SelectionSummary {...props} placeCount={0} />);
    expect(screen.getByRole("status").textContent).toBe("已选 0 个地点");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "查看所选" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "继续规划" }).disabled).toBe(true);
  });

  it("preserves the count and review action while blocking duplicate requests", () => {
    const onContinue = vi.fn();
    const onReview = vi.fn();
    render(<SelectionSummary {...props} busy onContinue={onContinue} onReview={onReview} />);
    const action = screen.getByRole("button", { name: "整理中…" });
    expect(action.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(action);
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("已选 8 个地点");
    fireEvent.click(screen.getByRole("button", { name: "查看所选" }));
    expect(onReview).toHaveBeenCalledOnce();
  });
});

describe("selection count presentation", () => {
  it("announces caller-supplied place counts without creating individual chips", () => {
    const { rerender } = render(<SelectionSummary {...props} />);
    rerender(<SelectionSummary {...props} placeCount={1200} />);
    expect(screen.getByRole("status").textContent).toBe("已选 1,200 个地点");
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("uses singular English for one place", () => {
    render(<SelectionSummary {...props} dict={chatDictFor("en")} placeCount={1} />);
    expect(screen.getByRole("status").textContent).toBe("1 place selected");
    expect(screen.getByRole("button", { name: "Review selection" })).toBeTruthy();
  });

  it("formats larger English counts", () => {
    render(<SelectionSummary {...props} dict={chatDictFor("en")} placeCount={1200} />);
    expect(screen.getByRole("status").textContent).toBe("1,200 places selected");
    expect(screen.getByRole("button", { name: "Plan trip" })).toBeTruthy();
  });

  it("localizes the summary and actions in Japanese", () => {
    render(<SelectionSummary {...props} dict={chatDictFor("ja")} placeCount={3} />);
    expect(screen.getByRole("status").textContent).toBe("3か所を選択中");
    expect(screen.getByRole("button", { name: "選んだ場所を見る" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "プランを作る" })).toBeTruthy();
  });
});
