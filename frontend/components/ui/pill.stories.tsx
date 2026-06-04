// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { Pill } from "./pill";

const meta = {
  title: "UI/Pill",
  component: Pill,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["hint", "corner", "tag"],
    },
  },
} satisfies Meta<typeof Pill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "ログインは保存するときだけ" },
};

export const Hint: Story = {
  args: { variant: "hint", children: "ログインは保存するときだけ" },
};

export const Corner: Story = {
  args: { variant: "corner", children: "アニメ" },
};

export const Tag: Story = {
  args: { variant: "tag", children: "徒歩 15分" },
};

export const AllVariants: Story = {
  name: "All Variants",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Pill variant="hint">hint</Pill>
      <Pill variant="corner">corner</Pill>
      <Pill variant="tag">tag</Pill>
    </div>
  ),
};
