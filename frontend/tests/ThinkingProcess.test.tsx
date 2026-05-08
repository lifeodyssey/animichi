import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ThinkingProcess from "../components/chat/ThinkingProcess";
import defaultDict from "../lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

describe("ThinkingProcess", () => {
  it("renders thinking indicator when streaming", () => {
    render(<ThinkingProcess isStreaming />);
    expect(screen.getByTestId("thinking-indicator")).toBeInTheDocument();
    expect(screen.getByText(defaultDict.thinking.pre_thinking)).toBeInTheDocument();
  });

  it("returns null when not streaming", () => {
    const { container } = render(<ThinkingProcess isStreaming={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders a skeleton dot as loading indicator", () => {
    render(<ThinkingProcess isStreaming />);
    const skeleton = document.querySelector("[data-slot='skeleton']");
    expect(skeleton).not.toBeNull();
  });

  it("does not use emoji for indicators", () => {
    render(<ThinkingProcess isStreaming />);
    const container = screen.getByTestId("thinking-indicator");
    expect(container.textContent).not.toContain("\uD83E\uDDE0");
  });
});
