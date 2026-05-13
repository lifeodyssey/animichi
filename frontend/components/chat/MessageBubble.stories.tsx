import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import type { UIMessage, DynamicToolUIPart } from "ai";
import MessageBubble from "./MessageBubble";

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
    case "input-available":
      return { ...base, state, input: {}, ...overrides } as DynamicToolUIPart;
    case "output-available":
      return { ...base, state, input: {}, output: {}, ...overrides } as DynamicToolUIPart;
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

const userMessage: UIMessage = {
  id: "msg-user-001",
  role: "user",

  parts: [{ type: "text", text: "響け！ユーフォニアムの聖地を教えて" }],
};

const assistantTextMessage: UIMessage = {
  id: "msg-asst-001",
  role: "assistant",

  parts: [
    {
      type: "text",
      text: "響け！ユーフォニアムの聖地は主に京都府宇治市にあります。宇治川沿いや宇治市内各所が舞台となっています。",
    },
  ],
};

const assistantStreamingMessage: UIMessage = {
  id: "msg-asst-stream",
  role: "assistant",

  parts: [],
};

const assistantWithToolsMessage: UIMessage = {
  id: "msg-asst-tools",
  role: "assistant",

  parts: [
    makeToolPart("resolve_anime", "output-available", { output: resolveOutput }) as unknown as UIMessage["parts"][number],
    makeToolPart("search_bangumi", "output-available", { output: searchOutput }) as unknown as UIMessage["parts"][number],
  ],
};

const assistantRunningMessage: UIMessage = {
  id: "msg-asst-running",
  role: "assistant",

  parts: [
    makeToolPart("resolve_anime", "input-available") as unknown as UIMessage["parts"][number],
  ],
};

const meta = {
  title: "Chat/MessageBubble",
  component: MessageBubble,
  tags: ["autodocs"],
  args: {
    onActivate: fn(),
    onOpenDrawer: fn(),
    isActive: false,
    isStreaming: false,
  },
} satisfies Meta<typeof MessageBubble>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserMessage: Story = {
  args: { message: userMessage },
};

export const AssistantText: Story = {
  args: { message: assistantTextMessage },
};

export const AssistantStreaming: Story = {
  args: {
    message: assistantStreamingMessage,
    isStreaming: true,
  },
};

export const AssistantWithToolsRunning: Story = {
  args: {
    message: assistantRunningMessage,
    isStreaming: true,
  },
};

export const AssistantWithToolsDone: Story = {
  args: {
    message: assistantWithToolsMessage,
    isStreaming: false,
  },
};
