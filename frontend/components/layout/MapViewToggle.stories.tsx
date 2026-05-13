import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { MapViewToggle } from "./MapViewToggle";

const meta = {
  title: "Layout/MapViewToggle",
  component: MapViewToggle,
  tags: ["autodocs"],
  args: {
    onViewChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="relative h-[120px] w-[300px] bg-muted">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MapViewToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MapActive: Story = {
  args: { view: "map" },
};

export const GridActive: Story = {
  args: { view: "grid" },
};
