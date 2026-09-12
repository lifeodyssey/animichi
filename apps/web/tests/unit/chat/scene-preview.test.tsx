/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenePreview } from "../../../src/features/chat/components/ScenePreview";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { nativeDialogFixture } from "./dialog-fixture";

afterEach(cleanup);
nativeDialogFixture();
const search = chatDictFor("zh").search;
const props = { src: "/bridge.webp", name: "宇治橋", closeLabel: search.closePreview, failureMessage: search.sceneUnavailable };

describe("scene preview dismissal and recovery", () => {
  it("dismisses on Escape or the backdrop, but not when the image is clicked", () => {
    const onClose = vi.fn();
    render(<ScenePreview {...props} onClose={onClose} />);
    fireEvent.click(screen.getByRole("img"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the location and close action available if the larger image fails", () => {
    const onClose = vi.fn();
    render(<ScenePreview {...props} caption="宇治市 · 第2集" onClose={onClose} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("status").textContent).toBe(search.sceneUnavailable);
    expect(screen.getByRole("heading", { name: props.name })).toBeTruthy();
    expect(screen.getByText("宇治市 · 第2集")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: search.closePreview }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
