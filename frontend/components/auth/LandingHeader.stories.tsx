import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import LandingHeader from "./LandingHeader";

const meta = {
  title: "Landing/Hero/1 Header",
  component: LandingHeader,
  parameters: {
    layout: "fullscreen",
    // Target design attached via @storybook/addon-designs — shows in the "Design" tab.
    design: {
      type: "image",
      url: "/design-targets/target-header.png",
    },
  },
} satisfies Meta<typeof LandingHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onLogin: fn() },
  render: (args) => (
    <div style={{ background: "var(--animal-bg-color-content)", minHeight: 200 }}>
      <LandingHeader {...args} />
    </div>
  ),
};
