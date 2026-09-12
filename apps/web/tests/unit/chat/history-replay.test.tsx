/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryList } from "../../../src/features/chat/components/HistoryList";
import type { HistoryReplayEntry } from "../../../src/features/chat/lib/history-replay";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { draftFixture } from "./itinerary-draft-fixture";

afterEach(cleanup);
const dict = chatDictFor("zh");
const text = [{ id: "message-1", role: "assistant", content: "这是一版草案。", intent: "plan_route" }] as const;
const restored: readonly HistoryReplayEntry[] = [{ ...text[0], blocks: [{ id: "draft-block", kind: "draft", draft: draftFixture }] }];

describe("historical content requires explicit restored data", () => {
  it("keeps legacy messages without exposing intent or inferring a draft from prose", () => {
    render(<HistoryList entries={text} dict={dict} />);
    expect(screen.getByText("这是一版草案。")).toBeTruthy();
    expect(screen.queryByText("plan_route")).toBeNull();
    expect(screen.queryByRole("button", { name: "继续调整" })).toBeNull();
    expect(screen.queryByRole("region", { name: "东京半日巡礼" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("continues the chosen historical draft version without offering selection or save controls", () => {
    const onContinueDraft = vi.fn();
    const earlier = { ...draftFixture, id: "earlier-draft", title: "早一版草案" };
    const entries: readonly HistoryReplayEntry[] = [{ ...text[0], blocks: [{ id: "earlier-block", kind: "draft", draft: earlier }, { id: "current-block", kind: "draft", draft: draftFixture }] }];
    render(<HistoryList entries={entries} dict={dict} status="success" onContinueDraft={onContinueDraft} />);
    fireEvent.click(within(screen.getByRole("region", { name: "早一版草案" })).getByRole("button", { name: "继续调整" }));
    expect(onContinueDraft).toHaveBeenCalledExactlyOnceWith("earlier-draft");
    expect(screen.queryByRole("button", { name: "保存草案" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("region", { name: "东京半日巡礼" }).textContent).toContain("参宮橋 1号踏切");
  });

  it("retains available messages and draft when a separate historical block is missing", () => {
    const entries: readonly HistoryReplayEntry[] = [{ ...text[0], blocks: [{ id: "missing-scenes", kind: "unavailable", content: "scenes" }, { id: "ready-draft", kind: "draft", draft: draftFixture }] }];
    render(<HistoryList entries={entries} dict={dict} status="success" />);
    expect(screen.getByRole("status").textContent).toContain("部分内容还没恢复");
    expect(screen.getByText("这部分地点图片未能恢复。")).toBeTruthy();
    expect(screen.getByText("这是一版草案。")).toBeTruthy();
    expect(screen.getByRole("region", { name: "东京半日巡礼" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重新加载" })).toBeNull();
  });

  it("never substitutes a missing draft with a newly constructed one", () => {
    const entries: readonly HistoryReplayEntry[] = [{ ...text[0], blocks: [{ id: "missing-draft", kind: "unavailable", content: "draft" }] }];
    const onContinueDraft = vi.fn();
    render(<HistoryList entries={entries} dict={dict} status="success" onContinueDraft={onContinueDraft} />);
    expect(screen.getByText("这版行程草案未能恢复。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "继续调整" })).toBeNull();
    expect(onContinueDraft).not.toHaveBeenCalled();
  });
});

describe("restoration state remains distinct from a fresh conversation", () => {
  it("announces loading without reporting an empty history", () => {
    render(<HistoryList entries={[]} dict={dict} status="loading" />);
    expect(screen.getByRole("status").textContent).toContain("正在找回这段会话…");
    expect(screen.queryByText("这段会话还没有可显示的内容。")).toBeNull();
  });

  it("retries a failed read without pretending content has recovered", () => {
    const onRetry = vi.fn();
    render(<HistoryList entries={[]} dict={dict} status="error" onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("这段会话暂时没加载出来");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(onRetry).toHaveBeenCalledExactlyOnceWith();
    expect(screen.queryByText("这段会话还没有可显示的内容。")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("retains the draft during a refresh but waits before continuing it", () => {
    const onContinueDraft = vi.fn();
    const { rerender } = render(<HistoryList entries={restored} dict={dict} status="loading" onContinueDraft={onContinueDraft} />);
    expect(screen.getByRole("region", { name: "东京半日巡礼" })).toBeTruthy();
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "继续调整" });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onContinueDraft).not.toHaveBeenCalled();
    rerender(<HistoryList entries={restored} dict={dict} status="success" onContinueDraft={onContinueDraft} />);
    fireEvent.click(screen.getByRole("button", { name: "继续调整" }));
    expect(onContinueDraft).toHaveBeenCalledExactlyOnceWith("draft-a");
  });

  it("keeps a restored draft visible if refreshing the history fails", () => {
    render(<HistoryList entries={restored} dict={dict} status="error" />);
    expect(screen.getByRole("alert").textContent).toContain("已显示的内容仍可查看");
    expect(screen.getByRole("region", { name: "东京半日巡礼" })).toBeTruthy();
  });

  it("hides cached entries while the owner disables history", () => {
    render(<HistoryList entries={restored} dict={dict} status="idle" />);
    expect(screen.queryByText("这是一版草案。")).toBeNull();
  });

  it("shows an explicit empty state only for a completed read", () => {
    render(<HistoryList entries={[]} dict={dict} status="success" />);
    expect(screen.getByText("这段会话还没有可显示的内容。")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
