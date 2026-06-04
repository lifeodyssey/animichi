// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import CornerLabel from "./CornerLabel";

const meta = {
  title: "Landing/SceneCard/CornerLabel",
  component: CornerLabel,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof CornerLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { side: "left", tone: "anime", text: "Anime" },
  render: (args) => (
    <div
      style={{ position: "relative", width: 320, height: 120, background: "var(--color-muted)" }}
    >
      <CornerLabel {...args} />
    </div>
  ),
};
