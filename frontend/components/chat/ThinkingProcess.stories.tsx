import type { Meta, StoryObj } from "@storybook/react";
import ThinkingProcess from "./ThinkingProcess";

const meta = {
  title: "Chat/ThinkingProcess",
  component: ThinkingProcess,
  tags: ["autodocs"],
} satisfies Meta<typeof ThinkingProcess>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Streaming: Story = {
  args: { isStreaming: true },
};

export const NotStreaming: Story = {
  args: { isStreaming: false },
};
