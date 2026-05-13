import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "ルートを計画" } };

export const Outline: Story = {
  args: { variant: "outline", children: "聖地を探す" },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "詳細を見る" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "キャンセル" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "削除する" },
};

export const Link: Story = {
  args: { variant: "link", children: "もっと見る" },
};

export const Small: Story = {
  args: { size: "sm", children: "保存" },
};

export const Large: Story = {
  args: { size: "lg", children: "聖地巡礼を始める" },
};
