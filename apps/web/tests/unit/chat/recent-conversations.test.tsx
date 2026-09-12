/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecentConversations } from "../../../src/features/chat/components/RecentConversations";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);
const conversations = [
  { id: "tokyo /1?", title: "东京半日巡礼", subtitle: "从四谷出发" },
  { id: "uji", title: "宇治沿河散步", subtitle: "一天时间" },
] as const;
const props = { dict: chatDictFor("zh"), conversations, status: "success", activeSessionId: "tokyo /1?", onRetry: vi.fn() } as const;

describe("returning to an identified conversation", () => {
  it("preserves the complete session id in native destinations and emits the selected id", () => {
    const onOpen = vi.fn();
    render(<RecentConversations {...props} onOpen={onOpen} />);
    const current = screen.getByRole("link", { name: "东京半日巡礼" });
    expect(current.getAttribute("href")).toBe("/chat?session=tokyo%20%2F1%3F");
    expect(current.getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("link", { name: "宇治沿河散步" }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("uji");
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "宇治沿河散步" }).getAttribute("aria-current")).toBeNull();
  });

  it("leaves modified navigation to the native link", () => {
    const onOpen = vi.fn();
    render(<RecentConversations {...props} onOpen={onOpen} />);
    document.addEventListener("click", (event) => { event.preventDefault(); }, { once: true });
    fireEvent.click(screen.getByRole("link", { name: "宇治沿河散步" }), { ctrlKey: true });
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "宇治沿河散步" }).getAttribute("href")).toBe("/chat?session=uji");
  });

  it("changes the current row only when the owner changes the active session", () => {
    const { rerender } = render(<RecentConversations {...props} />);
    rerender(<RecentConversations {...props} activeSessionId="uji" />);
    expect(screen.getByRole("link", { name: "宇治沿河散步" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "东京半日巡礼" }).getAttribute("aria-current")).toBeNull();
  });

  it("uses known text for missing titles without duplicating the first query", () => {
    const entries = [{ id: "first", title: " ", subtitle: "周末去宇治" }, { id: "empty", title: "", subtitle: " " }, { id: "same", title: "镰仓看海", subtitle: "镰仓看海" }];
    render(<RecentConversations {...props} conversations={entries} />);
    expect(screen.getByRole("link", { name: "周末去宇治" }).textContent).toBe("周末去宇治");
    expect(screen.getByRole("link", { name: "未命名会话" }).textContent).toBe("未命名会话");
    expect(screen.getByRole("link", { name: "镰仓看海" }).textContent).toBe("镰仓看海");
  });
});

describe("list availability remains explicit", () => {
  it("hides cached conversations while the owner has disabled the list", () => {
    render(<RecentConversations {...props} status="idle" />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("东京半日巡礼")).toBeNull();
  });

  it("announces loading without claiming the account has no conversations", () => {
    render(<RecentConversations {...props} status="loading" conversations={[]} />);
    expect(screen.getByRole("status").textContent).toBe("正在加载会话…");
    expect(screen.queryByText("还没有最近会话")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows an empty state only after a successful empty response", () => {
    render(<RecentConversations {...props} conversations={[]} />);
    expect(screen.getByText("还没有最近会话")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "重新加载" })).toBeNull();
  });

  it("offers a retry without fabricating a recovered list", () => {
    const onRetry = vi.fn();
    render(<RecentConversations {...props} status="error" conversations={[]} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("最近会话暂时没加载出来");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(onRetry).toHaveBeenCalledExactlyOnceWith();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("还没有最近会话")).toBeNull();
  });

  it("preserves existing rows and keyboard focus when refreshing or refresh fails", () => {
    const onOpen = vi.fn(), onRetry = vi.fn();
    const { rerender } = render(<RecentConversations {...props} onOpen={onOpen} onRetry={onRetry} />);
    const current = screen.getByRole("link", { name: "东京半日巡礼" });
    current.focus();
    rerender(<RecentConversations {...props} status="loading" onOpen={onOpen} onRetry={onRetry} />);
    expect(screen.getByRole("status").textContent).toBe("正在更新列表…");
    expect(document.activeElement).toBe(current);
    rerender(<RecentConversations {...props} status="error" onOpen={onOpen} onRetry={onRetry} />);
    expect(document.activeElement).toBe(current);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("alert").textContent).toContain("已有会话仍可打开");
    fireEvent.click(current);
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("tokyo /1?");
    expect(onRetry).toHaveBeenCalledExactlyOnceWith();
  });
});
