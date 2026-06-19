// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { ExploreButton } from "./explore-button";

const meta = {
  title: "UI/ExploreButton",
  component: ExploreButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
  },
  args: { onClick: fn() },
} satisfies Meta<typeof ExploreButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "聖地巡礼を始める" },
};

export const Small: Story = {
  args: { size: "sm", children: "探す" },
};

export const Medium: Story = {
  args: { size: "md", children: "聖地を探す" },
};

export const Large: Story = {
  args: { size: "lg", children: "ルートを保存" },
};

export const AllSizes: Story = {
  name: "All Sizes",
  render: (args) => (
    <div className="flex flex-wrap items-end gap-3">
      <ExploreButton {...args} size="sm">
        sm
      </ExploreButton>
      <ExploreButton {...args} size="md">
        md
      </ExploreButton>
      <ExploreButton {...args} size="lg">
        lg
      </ExploreButton>
    </div>
  ),
};
