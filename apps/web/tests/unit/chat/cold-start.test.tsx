/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColdStart } from "../../../src/features/chat/components/ColdStart";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

const zh = chatDictFor("zh");
const PROMPT_KEYS = ["entryAnimePrompt", "entryCityPrompt", "entryChatPrompt"] as const;
const CASES = LOCALES.flatMap(locale => PROMPT_KEYS.map(key => ({ locale, key })));

afterEach(cleanup);

describe("the invitation supports a first conversation", () => {
  it.each(LOCALES)("introduces examples in %s without an automatic request", locale => {
    const dict = chatDictFor(locale), onChip = vi.fn();
    render(<ColdStart dict={dict} onChip={onChip} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(dict.coldStartHeading);
    expect(screen.getByRole("region", { name: dict.coldStartHeading })).toBeTruthy();
    expect(screen.getByText(dict.coldStartSub)).toBeTruthy();
    expect(screen.getByRole("group", { name: dict.coldStartExamples })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(onChip).not.toHaveBeenCalled();
  });

  it.each(CASES)("sends the visible $key question in $locale exactly once", ({ locale, key }) => {
    const dict = chatDictFor(locale), onChip = vi.fn();
    const prompt = dict[key];
    render(<ColdStart dict={dict} onChip={onChip} />);
    const button = screen.getByRole("button", { name: prompt });
    expect(button.textContent).toContain(prompt);
    expect(button.className).toContain("animal-btn");
    fireEvent.click(button);
    expect(onChip).toHaveBeenCalledExactlyOnceWith(prompt);
  });

  it("associates each concrete question with its visible context label", () => {
    render(<ColdStart dict={zh} onChip={vi.fn()} />);
    const button = screen.getByRole("button", { name: zh.entryAnimePrompt });
    const labelId = button.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(labelId)?.textContent).toBe(zh.entryAnimeTitle);
    expect(screen.queryByRole("button", { name: /示例对话/ })).toBeNull();
  });
});

describe("disabled entry and focus ownership", () => {
  it("does not send any starter while the component is disabled", () => {
    const onChip = vi.fn();
    render(<ColdStart dict={zh} onChip={onChip} disabled />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.every(button => button.hasAttribute("disabled"))).toBe(true);
    buttons.forEach(button => { fireEvent.click(button); });
    expect(onChip).not.toHaveBeenCalled();
  });

  it("does not steal focus from the existing input area on mount", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    render(<ColdStart dict={zh} onChip={vi.fn()} />);
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("gives separate instances distinct labels", () => {
    render(<><ColdStart dict={zh} onChip={vi.fn()} /><ColdStart dict={zh} onChip={vi.fn()} /></>);
    const buttons = screen.getAllByRole("button", { name: zh.entryAnimePrompt });
    expect(buttons[0]?.getAttribute("aria-labelledby")).not.toBe(buttons[1]?.getAttribute("aria-labelledby"));
    expect(buttons[0]?.getAttribute("aria-describedby")).not.toBe(buttons[1]?.getAttribute("aria-describedby"));
  });
});
