import type { Meta, StoryObj, Decorator } from "@storybook/react";
import { fn } from "storybook/test";
import { SelectionBar } from "./SelectionBar";

const meta = {
  title: "Layout/SelectionBar",
  component: SelectionBar,
  tags: ["autodocs"],
  args: {
    onPlanRoute: fn(),
    onClear: fn(),
  },
  decorators: [
    (Story) => (
      <div className="relative h-[80px] w-[600px] bg-muted">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SelectionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneSelected: Story = {
  args: { count: 1 },
};

export const TwoSelected: Story = {
  args: { count: 2 },
};

export const ManySelected: Story = {
  args: { count: 5 },
};

export const Disabled: Story = {
  args: { count: 3, disabled: true },
};

export const WithFloatingList: Story = {
  args: { count: 3, hasFloatingList: true },
  decorators: [
    ((Story) => (
      <div className="relative h-[80px] w-[800px] bg-muted">
        <Story />
      </div>
    )) satisfies Decorator,
  ],
};
