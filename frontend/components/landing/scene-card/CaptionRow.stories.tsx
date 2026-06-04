// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import CaptionRow from "./CaptionRow";

const meta = {
  title: "Landing/SceneCard/CaptionRow",
  component: CaptionRow,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof CaptionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { name: "Fushimi Inari Taisha", area: "Kyoto, Japan" },
  render: (args) => (
    <div style={{ background: "var(--color-card)", padding: 16, borderRadius: 16, width: 320 }}>
      <CaptionRow {...args} />
    </div>
  ),
};
