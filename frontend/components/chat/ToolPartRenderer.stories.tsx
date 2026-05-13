import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import type { DynamicToolUIPart } from "ai";
import { PipelineCard } from "./ToolPartRenderer";

function makeToolPart(
  toolName: string,
  state: DynamicToolUIPart["state"],
  overrides: Partial<DynamicToolUIPart> = {},
): DynamicToolUIPart {
  const base = {
    type: "dynamic-tool" as const,
    toolName,
    toolCallId: `call-${toolName}-story`,
  };
  switch (state) {
    case "input-streaming":
      return { ...base, state, input: undefined, ...overrides } as DynamicToolUIPart;
    case "input-available":
      return { ...base, state, input: {}, ...overrides } as DynamicToolUIPart;
    case "output-available":
      return { ...base, state, input: {}, output: {}, ...overrides } as DynamicToolUIPart;
    case "output-error":
      return { ...base, state, input: {}, errorText: "エラーが発生しました", ...overrides } as DynamicToolUIPart;
    default:
      return { ...base, state, input: {}, ...overrides } as DynamicToolUIPart;
  }
}

const searchOutput = {
  intent: "search_bangumi",
  session_id: "sess-story-001",
  message: "響け！ユーフォニアム の聖地が見つかりました。",
  success: true,
  status: "ok",
  data: { results: { rows: Array(70).fill({}), row_count: 70 } },
  session: { interaction_count: 1, route_history_count: 0 },
  route_history: [],
  errors: [],
};

const resolveOutput = {
  intent: "resolve_anime",
  session_id: "sess-story-001",
  message: "響け！ユーフォニアム",
  success: true,
  status: "ok",
  data: { intent: "resolve_anime" },
  session: { interaction_count: 1, route_history_count: 0 },
  route_history: [],
  errors: [],
};

const meta = {
  title: "Chat/ToolPartRenderer",
  component: PipelineCard,
  tags: ["autodocs"],
  args: {
    messageId: "msg-001",
    onActivate: fn(),
    onOpenDrawer: fn(),
    isActive: false,
  },
} satisfies Meta<typeof PipelineCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  args: {
    parts: [makeToolPart("resolve_anime", "input-available")],
  },
};

export const MultiStepRunning: Story = {
  args: {
    parts: [
      makeToolPart("resolve_anime", "output-available", { output: resolveOutput }),
      makeToolPart("search_bangumi", "input-available"),
    ],
  },
};

export const AllDone: Story = {
  args: {
    parts: [
      makeToolPart("resolve_anime", "output-available", { output: resolveOutput }),
      makeToolPart("search_bangumi", "output-available", { output: searchOutput }),
    ],
  },
};

export const WithError: Story = {
  args: {
    parts: [
      makeToolPart("resolve_anime", "output-error", {
        errorText: "アニメタイトルが見つかりませんでした",
      }),
    ],
  },
};

export const ActivePanel: Story = {
  args: {
    isActive: true,
    parts: [
      makeToolPart("resolve_anime", "output-available", { output: resolveOutput }),
      makeToolPart("search_bangumi", "output-available", { output: searchOutput }),
    ],
  },
};
