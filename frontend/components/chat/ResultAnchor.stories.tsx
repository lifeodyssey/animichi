import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import ResultAnchor from "./ResultAnchor";

const meta = {
  title: "Chat/ResultAnchor",
  component: ResultAnchor,
  tags: ["autodocs"],
  args: {
    label: "70件のスポットを表示",
    subtitle: "タップして結果を見る",
    messageId: "msg-001",
    isActive: false,
    onActivate: fn(),
    onOpenDrawer: fn(),
  },
} satisfies Meta<typeof ResultAnchor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Active: Story = {
  args: { isActive: true },
};

export const RouteResult: Story = {
  args: {
    label: "8か所の巡礼ルート",
    subtitle: "タップしてルートを確認",
  },
};

export const NoCallbacks: Story = {
  args: {
    onActivate: undefined,
    onOpenDrawer: undefined,
  },
};
