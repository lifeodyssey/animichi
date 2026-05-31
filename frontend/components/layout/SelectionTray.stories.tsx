import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { SelectionTray } from "./SelectionTray";

const makeSpot = (i: number) => ({ id: `spot-${i}`, name: `スポット${i} 長めの名前テスト` });

const meta = {
  title: "Layout/SelectionTray",
  component: SelectionTray,
  tags: ["autodocs"],
  args: {
    onPlanRoute: fn(),
    onRemove: fn(),
    onClear: fn(),
  },
  decorators: [
    (Story) => (
      <div className="relative h-[300px] w-full bg-background">
        <div className="absolute inset-x-0 bottom-0">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof SelectionTray>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { spots: [] },
};

export const OneSelected: Story = {
  args: { spots: [makeSpot(1)] },
};

export const Happy: Story = {
  args: {
    spots: [makeSpot(1), makeSpot(2), makeSpot(3)],
  },
};

export const SixSelected: Story = {
  args: {
    spots: Array.from({ length: 6 }, (_, i) => makeSpot(i + 1)),
  },
};

export const Overflow8: Story = {
  args: {
    spots: Array.from({ length: 8 }, (_, i) => makeSpot(i + 1)),
  },
};

export const Overflow12: Story = {
  args: {
    spots: Array.from({ length: 12 }, (_, i) => makeSpot(i + 1)),
  },
};

export const Disabled: Story = {
  args: {
    spots: [makeSpot(1), makeSpot(2), makeSpot(3)],
    disabled: true,
  },
};
