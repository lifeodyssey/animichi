import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineCard } from "../components/chat/ToolPartRenderer";
import type { DynamicToolUIPart } from "ai";
import defaultDict from "../lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

vi.mock("@/contexts/SuggestContext", () => ({
  useSuggest: () => vi.fn(),
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

function makeSearchOutput(count: number) {
  return {
    success: true,
    status: "ok",
    intent: "search_bangumi",
    session_id: "sess-1",
    message: "Found spots",
    data: {
      intent: "search_bangumi",
      results: { rows: Array(count).fill({}), row_count: count },
    },
    session: { interaction_count: 1, route_history_count: 0 },
    route_history: [],
    errors: [],
  };
}

function makeResolveOutput(title: string) {
  return {
    success: true,
    status: "ok",
    intent: "resolve_anime",
    session_id: "sess-1",
    message: title,
    data: { intent: "resolve_anime" },
    session: { interaction_count: 1, route_history_count: 0 },
    route_history: [],
    errors: [],
  };
}

describe("PipelineCard", () => {
  it("renders a pipeline card container", () => {
    const parts = [makeToolPart("resolve_anime", "input-available")];
    render(<PipelineCard parts={parts} messageId="msg-1" />);
    expect(screen.getByTestId("pipeline-card")).toBeInTheDocument();
  });

  it("shows running state with shimmer for in-progress tool", () => {
    const parts = [makeToolPart("resolve_anime", "input-available")];
    render(<PipelineCard parts={parts} messageId="msg-1" />);
    const step = screen.getByTestId("pipeline-step-resolve_anime");
    expect(step.dataset.state).toBe("running");
    expect(screen.getByText(defaultDict.thinking.resolve_anime)).toBeInTheDocument();
    // Should have a skeleton shimmer bar
    expect(step.querySelector("[data-slot='skeleton']")).not.toBeNull();
  });

  it("shows done state with checkmark and value for completed tool", () => {
    const output = makeResolveOutput("響け！ユーフォニアム");
    const parts = [
      makeToolPart("resolve_anime", "output-available", { output } as Partial<DynamicToolUIPart>),
    ];
    render(<PipelineCard parts={parts} messageId="msg-1" />);
    const step = screen.getByTestId("pipeline-step-resolve_anime");
    expect(step.dataset.state).toBe("done");
    expect(screen.getByText(defaultDict.thinking.done_resolve_anime)).toBeInTheDocument();
    expect(screen.getByText("響け！ユーフォニアム")).toBeInTheDocument();
  });

  it("shows error state for failed tool", () => {
    const parts = [
      makeToolPart("resolve_anime", "output-error", {
        errorText: "Title not found",
      } as Partial<DynamicToolUIPart>),
    ];
    render(<PipelineCard parts={parts} messageId="msg-1" />);
    const step = screen.getByTestId("pipeline-step-resolve_anime");
    expect(step.dataset.state).toBe("error");
    expect(screen.getByText("Title not found")).toBeInTheDocument();
  });

  it("renders multiple steps with connectors", () => {
    const parts = [
      makeToolPart("resolve_anime", "output-available", {
        output: makeResolveOutput("テスト"),
      } as Partial<DynamicToolUIPart>),
      makeToolPart("search_bangumi", "input-available"),
    ];
    render(<PipelineCard parts={parts} messageId="msg-1" />);
    expect(screen.getByTestId("pipeline-step-resolve_anime")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-step-search_bangumi")).toBeInTheDocument();
    // Pipeline card should be present
    expect(screen.getByTestId("pipeline-card")).toBeInTheDocument();
  });

  it("filters out greet_user from pipeline", () => {
    const parts = [makeToolPart("greet_user", "output-available", {
      output: { intent: "greet_user", message: "hi", data: {}, session: { interaction_count: 1, route_history_count: 0 }, route_history: [], errors: [], success: true, status: "ok" },
    } as Partial<DynamicToolUIPart>)];
    const { container } = render(<PipelineCard parts={parts} messageId="msg-1" />);
    expect(container.querySelector("[data-testid='pipeline-card']")).toBeNull();
  });

  it("renders result anchor for visual tool output", () => {
    const output = makeSearchOutput(70);
    const parts = [
      makeToolPart("search_bangumi", "output-available", { output } as Partial<DynamicToolUIPart>),
    ];
    render(<PipelineCard parts={parts} messageId="msg-1" />);
    // Should have a result anchor button
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("shows spot count in done value for search tool", () => {
    const output = makeSearchOutput(70);
    const parts = [
      makeToolPart("search_bangumi", "output-available", { output } as Partial<DynamicToolUIPart>),
    ];
    render(<PipelineCard parts={parts} messageId="msg-1" />);
    expect(screen.getByText(defaultDict.thinking.value_spots.replace("{count}", "70"))).toBeInTheDocument();
  });

  it("does not use emoji anywhere in the pipeline", () => {
    const parts = [
      makeToolPart("resolve_anime", "input-available"),
      makeToolPart("search_bangumi", "input-available"),
    ];
    render(<PipelineCard parts={parts} messageId="msg-1" />);
    const card = screen.getByTestId("pipeline-card");
    const text = card.textContent ?? "";
    // No common emoji codepoints
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("does not use animate-pulse class", () => {
    const parts = [makeToolPart("resolve_anime", "input-available")];
    render(<PipelineCard parts={parts} messageId="msg-1" />);
    const card = screen.getByTestId("pipeline-card");
    // The Skeleton component uses animate-pulse but PipelineStep itself should not
    const nonSkeleton = Array.from(card.querySelectorAll("*"))
      .filter((el) => !el.hasAttribute("data-slot"));
    for (const el of nonSkeleton) {
      expect(el.className).not.toContain("animate-pulse");
    }
  });
});
