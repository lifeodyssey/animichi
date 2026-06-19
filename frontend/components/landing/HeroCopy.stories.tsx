import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import HeroCopy from "./HeroCopy";

const meta = {
  title: "Landing/HeroCopy",
  component: HeroCopy,
  parameters: {
    layout: "fullscreen",
    // Target design attached via @storybook/addon-designs — shows in the "Design" tab.
    design: {
      type: "image",
      url: "/design-targets/landing-hero-intro.png",
    },
  },
} satisfies Meta<typeof HeroCopy>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onSearch: fn() },
  render: (args) => (
    <div className="min-h-[560px] bg-background px-12 py-14">
      <div className="max-w-[640px]">
        <HeroCopy {...args} />
      </div>
    </div>
  ),
};
