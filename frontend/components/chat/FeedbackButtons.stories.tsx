import type { Meta, StoryObj } from "@storybook/react";
import type { DynamicToolUIPart } from "ai";
import FeedbackButtons from "./FeedbackButtons";

function makeToolPart(
  toolName: string,
  output: Record<string, unknown>,
): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolName,
    toolCallId: `call-${toolName}-story`,
    state: "output-available",
    input: {},
    output,
  } as DynamicToolUIPart;
}

const searchOutput = {
  intent: "search_bangumi",
  session_id: "sess-story-001",
  message: "響け！ユーフォニアム の聖地が見つかりました。",
  success: true,
  status: "ok",
  data: { results: { rows: [], row_count: 70 } },
  session: { interaction_count: 1, route_history_count: 0 },
  route_history: [],
  errors: [],
};

const routeOutput = {
  intent: "plan_route",
  session_id: "sess-story-002",
  message: "ルートを作成しました。",
  success: true,
  status: "ok",
  data: { route: { ordered_points: [], point_count: 8 } },
  session: { interaction_count: 2, route_history_count: 1 },
  route_history: [],
  errors: [],
};

const meta = {
  title: "Chat/FeedbackButtons",
  component: FeedbackButtons,
  tags: ["autodocs"],
  args: {
    messageId: "msg-001",
    userQuery: "響け！ユーフォニアムの聖地を教えて",
  },
} satisfies Meta<typeof FeedbackButtons>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSearchResult: Story = {
  args: {
    toolParts: [makeToolPart("search_bangumi", searchOutput)],
  },
};

export const WithRouteResult: Story = {
  args: {
    messageId: "msg-002",
    userQuery: "宇治のルートを作って",
    toolParts: [makeToolPart("plan_route", routeOutput)],
  },
};

export const NoToolOutput: Story = {
  args: {
    toolParts: [],
  },
};
