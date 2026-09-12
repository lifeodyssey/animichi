import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { FallbackRetryButton } from "./FallbackRetryButton";

const meta = {
  title: "Chat/Errors/FallbackRetryButton",
  component: FallbackRetryButton,
  args: { label: "もう一度試す", onClick: fn(), className: "chat-interruption__retry" },
  tags: ["autodocs"],
} satisfies Meta<typeof FallbackRetryButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const Recovering: Story = { args: { disabled: true, label: "再接続中…" } };
