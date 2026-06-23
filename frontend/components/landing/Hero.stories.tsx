import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import Hero from "./Hero";

const meta = {
  title: "Landing/Hero",
  component: Hero,
  parameters: {
    layout: "fullscreen",
    // Target design attached via @storybook/addon-designs — shows in the "Design" tab.
    // Hero band of the approved redraw (header/footer cropped away).
    design: {
      type: "image",
      url: "/design-targets/landing-hero-section.png",
    },
  },
} satisfies Meta<typeof Hero>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onOpenAuth: fn() },
  render: (args) => (
    <div className="flex min-h-[720px] flex-col">
      <Hero {...args} />
    </div>
  ),
};
