/**
 * @vitest-environment jsdom
 *
 * ChatInput's documented startup rule: desktop starts in the field, while a
 * coarse-pointer or narrow viewport waits for a tap instead — the opening
 * keyboard would cost that screen half the page. The viewport stub in
 * `tests/setup/viewport-hermetic.ts` reads `window.innerWidth` for the width
 * query, so the phone case is one assignment. #1604 deleted the photo search
 * surface (and with it the composer's camera key); this rule is what is left of
 * the composer's startup behavior and had no test of its own.
 *
 * test-type: unit
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../../src/features/chat/components/ChatInput";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderedField(): Promise<HTMLTextAreaElement> {
  render(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
  return await screen.findByRole<HTMLTextAreaElement>("textbox");
}

describe("ChatInput's startup focus rule (direction E)", () => {
  it("starts in the field on a desktop viewport", async () => {
    window.innerWidth = 1024;
    const field = await renderedField();
    expect(document.activeElement).toBe(field);
  });

  it("waits for a tap on a narrow viewport instead of opening the keyboard", async () => {
    window.innerWidth = 375;
    const field = await renderedField();
    expect(document.activeElement).not.toBe(field);
    expect(document.activeElement).toBe(document.body);
  });

  it("still starts in the field where matchMedia is unavailable", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const field = await renderedField();
    expect(document.activeElement).toBe(field);
  });
});
