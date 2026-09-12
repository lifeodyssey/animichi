/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftSaveActions } from "../../../src/features/chat/components/DraftSaveActions";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);
const props = { draftId: "draft-a", dict: chatDictFor("zh"), onSave: vi.fn(), onAdjust: vi.fn() };

describe("save requests are distinct from persistence outcomes", () => {
  it("requests the displayed draft without claiming success", () => {
    const onSave = vi.fn(), onAdjust = vi.fn();
    render(<DraftSaveActions {...props} onSave={onSave} onAdjust={onAdjust} />);
    fireEvent.click(screen.getByRole("button", { name: "保存草案" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("draft-a");
    expect(screen.queryByText("草案已保存")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "调整一下" }));
    expect(onAdjust).toHaveBeenCalledExactlyOnceWith("draft-a");
  });

  it("opens login only on the save tap, carrying the current draft id", () => {
    const onLogin = vi.fn(), onSave = vi.fn();
    render(<DraftSaveActions {...props} onSave={onSave} state={{ draftId: "draft-a", status: "login-required", onLogin }} />);
    expect(onLogin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "登录并保存" }));
    expect(onLogin).toHaveBeenCalledExactlyOnceWith("draft-a");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByText("草案已保存")).toBeNull();
  });

  it("keeps unknown auth inert while adjustment remains available", () => {
    const onSave = vi.fn(), onAdjust = vi.fn();
    render(<DraftSaveActions {...props} onSave={onSave} onAdjust={onAdjust} state={{ draftId: "draft-a", status: "checking" }} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "请稍候…" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "请稍候…" }));
    fireEvent.click(screen.getByRole("button", { name: "调整一下" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onAdjust).toHaveBeenCalledExactlyOnceWith("draft-a");
  });
});

describe("saving and failure feedback stay attached to the same version", () => {
  it("locks repeated saves and editing while the save is pending", () => {
    const onSave = vi.fn(), onAdjust = vi.fn();
    render(<DraftSaveActions {...props} onSave={onSave} onAdjust={onAdjust} state={{ draftId: "draft-a", status: "saving" }} />);
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "正在保存…" });
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(save);
    fireEvent.click(screen.getByRole("button", { name: "调整一下" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onAdjust).not.toHaveBeenCalled();
  });

  it("retries a transient failure with the original draft id", () => {
    const onSave = vi.fn();
    render(<DraftSaveActions {...props} onSave={onSave} state={{ draftId: "draft-a", status: "retryable" }} />);
    expect(screen.getByRole("alert").textContent).toContain("草案还在");
    fireEvent.click(screen.getByRole("button", { name: "重新保存" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("draft-a");
    expect(screen.queryByText("草案已保存")).toBeNull();
  });

  it("offers no retry for a permanent failure while preserving adjustment", () => {
    const onSave = vi.fn(), onAdjust = vi.fn();
    render(<DraftSaveActions {...props} onSave={onSave} onAdjust={onAdjust} state={{ draftId: "draft-a", status: "permanent" }} />);
    expect(screen.queryByRole("button", { name: "重新保存" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "暂时无法保存" }));
    fireEvent.click(screen.getByRole("button", { name: "调整一下" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onAdjust).toHaveBeenCalledExactlyOnceWith("draft-a");
  });
});

describe("saved navigation identifies the saved result", () => {
  it("opens the saved id without saving again", () => {
    const onSave = vi.fn(), onView = vi.fn();
    render(<DraftSaveActions {...props} onSave={onSave} state={{ draftId: "draft-a", status: "saved", savedId: "saved-42", onView }} />);
    expect(screen.getByRole("status").textContent).toContain("草案已保存");
    fireEvent.click(screen.getByRole("button", { name: "查看已保存行程" }));
    expect(onView).toHaveBeenCalledExactlyOnceWith("saved-42");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not carry an older version's saved badge or destination into a new draft", () => {
    const onSave = vi.fn(), onView = vi.fn();
    const state = { draftId: "draft-a", status: "saved", savedId: "saved-42", onView } as const;
    const { rerender } = render(<DraftSaveActions {...props} onSave={onSave} state={state} />);
    rerender(<DraftSaveActions {...props} draftId="draft-b" onSave={onSave} state={state} />);
    expect(screen.queryByText("草案已保存")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存草案" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("draft-b");
    expect(onView).not.toHaveBeenCalled();
  });
});
