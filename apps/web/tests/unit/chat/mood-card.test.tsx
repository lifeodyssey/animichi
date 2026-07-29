/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MoodCard } from "../../../src/features/chat/components/MoodCard";

afterEach(cleanup);

describe("B2c MoodCard", () => {
  it("renders the quote and its attribution when mood data exists", () => {
    render(<MoodCard mood={{ quote: "ここから、はじまるんだ。", source: "— 響け!ユーフォニアム" }} />);
    expect(screen.getByText("ここから、はじまるんだ。")).toBeTruthy();
    expect(screen.getByText("— 響け!ユーフォニアム")).toBeTruthy();
  });

  it("gracefully skips (renders nothing) when no quote data exists for the title", () => {
    const { container } = render(<MoodCard mood={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});
