import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./badge";

const meta = {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "destructive",
        "outline",
        "ghost",
        "link",
      ],
    },
  },
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

export const Link: Story = {
  args: { variant: "link", children: "詳細を見る" },
};

export const AllVariants: Story = {
  name: "All Variants",
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">EP 1-4</Badge>
      <Badge variant="secondary">宇治</Badge>
      <Badge variant="destructive">未訪問</Badge>
      <Badge variant="outline">京都府</Badge>
      <Badge variant="ghost">劇場版</Badge>
      <Badge variant="link">詳細を見る</Badge>
    </div>
  ),
};
