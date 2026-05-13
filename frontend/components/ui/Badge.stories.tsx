import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./badge";

const meta = {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "EP 1-4" } };

export const Secondary: Story = {
  args: { variant: "secondary", children: "宇治" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "未訪問" },
};

export const Outline: Story = {
  args: { variant: "outline", children: "京都府" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "劇場版" },
};
