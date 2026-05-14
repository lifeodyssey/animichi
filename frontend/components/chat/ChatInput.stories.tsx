import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import ChatInput from "./ChatInput";

const meta = {
  title: "Chat/ChatInput",
  component: ChatInput,
  tags: ["autodocs"],
  args: {
    onSend: fn(),
  },
} satisfies Meta<typeof ChatInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

export const WithPlaceholderOverride: Story = {
  args: { placeholderOverride: "響け！ユーフォニアム の聖地を探す…" },
};

export const WithLocationCallback: Story = {
  args: {
    onLocationAcquired: fn(),
  },
};
