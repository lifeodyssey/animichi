// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import MiniChecklist from "./MiniChecklist";

const meta = {
  title: "Landing/HowItWorks/MiniChecklist",
  component: MiniChecklist,
  parameters: { layout: "centered" },
} satisfies Meta<typeof MiniChecklist>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="w-[200px]">
      <MiniChecklist />
    </div>
  ),
};
