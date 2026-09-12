/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TypingIndicator } from "../../../src/features/chat/components/TypingIndicator";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { waitingCopy } from "../../../src/features/chat/waiting-copy";

afterEach(cleanup);

describe("TypingIndicator", () => {
  it.each(["zh", "en", "ja"] as const)("announces the localized wait in %s without a mascot", (locale) => {
    const { container } = render(<TypingIndicator dict={chatDictFor(locale)} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe(waitingCopy(locale).label);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps the accessible status node when its label and detail change", () => {
    const dict = chatDictFor("zh");
    const view = render(<TypingIndicator dict={dict} />);
    const status = screen.getByRole("status");
    view.rerender(<TypingIndicator dict={dict} label="正在更新回复…" detail="已有内容仍可查看。" />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("正在更新回复…已有内容仍可查看。");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
