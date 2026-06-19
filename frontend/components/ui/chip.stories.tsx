// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { Chip } from "./chip";

const meta = {
  title: "UI/Chip",
  component: Chip,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    tone: {
      control: "select",
      options: ["leaf", "teal", "gold"],
    },
  },
  args: { onClick: fn() },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "ゆるキャン△ の聖地" },
};

export const Leaf: Story = {
  args: { tone: "leaf", children: "けいおん！" },
};

export const Teal: Story = {
  args: { tone: "teal", children: "らき☆すた" },
};

export const Gold: Story = {
  args: { tone: "gold", children: "君の名は。" },
};

export const AllTones: Story = {
  name: "All Tones",
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Chip {...args} tone="leaf">
        leaf
      </Chip>
      <Chip {...args} tone="teal">
        teal
      </Chip>
      <Chip {...args} tone="gold">
        gold
      </Chip>
    </div>
  ),
};
