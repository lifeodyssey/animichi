// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import MiniMap from "./MiniMap";

const meta = {
  title: "Landing/HowItWorks/MiniMap",
  component: MiniMap,
  parameters: { layout: "centered" },
} satisfies Meta<typeof MiniMap>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="w-[200px]">
      <MiniMap />
    </div>
  ),
};
