import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ThinkingProcess from "../components/chat/ThinkingProcess";
import type { DynamicToolUIPart } from "ai";
import defaultDict from "../lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

function makeToolPart(
  toolName: string,
  state: DynamicToolUIPart["state"],
  overrides: Partial<DynamicToolUIPart> = {},
): DynamicToolUIPart {
  const base = {
    type: "dynamic-tool" as const,
    toolName,
    toolCallId: `call-${toolName}-${Math.random().toString(36).slice(2, 8)}`,
  };

  switch (state) {
    case "input-streaming":
      return { ...base, state, input: undefined, ...overrides } as DynamicToolUIPart;
    case "input-available":
      return { ...base, state, input: {}, ...overrides } as DynamicToolUIPart;
    case "output-available":
      return { ...base, state, input: {}, output: {}, ...overrides } as DynamicToolUIPart;
    case "output-error":
      return { ...base, state, input: {}, errorText: "Error occurred", ...overrides } as DynamicToolUIPart;
    default:
      return { ...base, state, input: {}, ...overrides } as DynamicToolUIPart;
  }
}

describe("ThinkingProcess", () => {
  it("renders tool labels from the thinking dict when tool parts are provided", () => {
    const toolParts = [
      makeToolPart("resolve_anime", "output-available"),
      makeToolPart("search_bangumi", "output-available"),
    ];
    render(<ThinkingProcess toolParts={toolParts} isStreaming={false} />);

    // The collapsed summary shows tool labels joined by arrows
    const resolveLabel = defaultDict.thinking.resolve_anime;
    const searchLabel = defaultDict.thinking.search_bangumi;
    expect(screen.getByText(new RegExp(resolveLabel))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(searchLabel))).toBeInTheDocument();
  });

  it("shows streaming indicator when isStreaming=true", () => {
    const toolParts = [makeToolPart("resolve_anime", "input-available")];
    render(<ThinkingProcess toolParts={toolParts} isStreaming={true} />);

    // When streaming with tool parts, the brain emoji should have animate-pulse class
    const brainElements = screen.getAllByText("\uD83E\uDDE0");
    const pulsingBrain = brainElements.find((el) =>
      el.className.includes("animate-pulse"),
    );
    expect(pulsingBrain).toBeDefined();
  });

  it("does not show streaming indicator when isStreaming=false and tools are done", () => {
    const toolParts = [makeToolPart("resolve_anime", "output-available")];
    render(<ThinkingProcess toolParts={toolParts} isStreaming={false} />);

    const brainElements = screen.getAllByText("\uD83E\uDDE0");
    // When not streaming, the brain emoji should NOT have animate-pulse
    const pulsingBrain = brainElements.find((el) =>
      el.className.includes("animate-pulse"),
    );
    expect(pulsingBrain).toBeUndefined();
  });

  it("renders tool names when expanded", () => {
    const toolParts = [
      makeToolPart("resolve_anime", "output-available"),
      makeToolPart("plan_route", "output-available"),
    ];
    render(<ThinkingProcess toolParts={toolParts} isStreaming={true} />);

    // Component starts expanded when isStreaming=true
    const resolveLabel = defaultDict.thinking.resolve_anime;
    const planLabel = defaultDict.thinking.plan_route;
    // Labels should appear in the expanded list
    const allText = screen.getAllByText(new RegExp(resolveLabel));
    expect(allText.length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(planLabel)).length).toBeGreaterThan(0);
  });

  it("shows the thinking label from dict when streaming with no tool parts", () => {
    render(<ThinkingProcess toolParts={[]} isStreaming={true} />);
    expect(
      screen.getByText(defaultDict.chat.thinking),
    ).toBeInTheDocument();
  });

  it("returns null when no tool parts and not streaming", () => {
    const { container } = render(
      <ThinkingProcess toolParts={[]} isStreaming={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("expands and collapses on button click", () => {
    const toolParts = [
      makeToolPart("resolve_anime", "output-available"),
      makeToolPart("search_bangumi", "output-available"),
    ];
    // isStreaming=false => starts collapsed
    render(<ThinkingProcess toolParts={toolParts} isStreaming={false} />);

    // Collapsed: expanded list should not be visible (only summary)
    // The border-l-2 div is the expanded content
    expect(document.querySelector(".border-l-2")).toBeNull();

    // Click to expand
    fireEvent.click(screen.getByRole("button"));

    // Now expanded content should appear
    expect(document.querySelector(".border-l-2")).not.toBeNull();
  });

  it("shows failed count when tool parts have failures", () => {
    const toolParts = [
      makeToolPart("resolve_anime", "output-error"),
    ];
    render(<ThinkingProcess toolParts={toolParts} isStreaming={false} />);

    expect(screen.getByText("(1 failed)")).toBeInTheDocument();
  });

  it("shows error text for failed tool when expanded", () => {
    const toolParts = [
      makeToolPart("resolve_anime", "output-error", { errorText: "Title not found in database" } as Partial<DynamicToolUIPart>),
    ];
    render(<ThinkingProcess toolParts={toolParts} isStreaming={true} />);

    // Failed observation should show warning sign
    expect(
      screen.getByText(/\u26A0.*Title not found in database/),
    ).toBeInTheDocument();
  });

  it("shows checkmark for successful tool when expanded", () => {
    const toolParts = [
      makeToolPart("resolve_anime", "output-available"),
    ];
    render(<ThinkingProcess toolParts={toolParts} isStreaming={true} />);

    // Successful tool should show checkmark
    expect(screen.getByText("\u2713")).toBeInTheDocument();
  });
});
