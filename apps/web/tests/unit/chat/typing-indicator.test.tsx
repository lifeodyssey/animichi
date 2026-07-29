/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TypingIndicator } from "../../../src/features/chat/components/TypingIndicator";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");

afterEach(cleanup);

describe("B2a TypingIndicator", () => {
  it("announces the thinking state with the fox avatar", () => {
    render(<TypingIndicator dict={ja} />);
    const status = screen.getByRole("status", { name: ja.thinking });
    const avatar = status.querySelector("img");
    expect(avatar?.getAttribute("src")).toBe("/images/chat/fox-thinking.webp");
  });

  it("keeps the bouncing dots decorative for screen readers", () => {
    render(<TypingIndicator dict={ja} />);
    const status = screen.getByRole("status", { name: ja.thinking });
    expect(status.querySelectorAll('[aria-hidden="true"] *').length).toBe(3);
  });
});
