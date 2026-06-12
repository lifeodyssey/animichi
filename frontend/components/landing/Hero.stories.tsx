import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import Hero from "./Hero";

const meta = {
  title: "Landing/Hero",
  component: Hero,
  parameters: {
    layout: "fullscreen",
    // Design tab: the hero band (header/footer cropped away), from the live build.
    design: { type: "image", url: "/design-targets/landing-hero-section.png" },
  },
} satisfies Meta<typeof Hero>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The assembled hero band: copy column + showcase card over the route trail. */
export const Default: Story = {
  args: { onOpenAuth: fn() },
  render: (args) => (
    <div className="flex min-h-[760px] flex-col bg-background">
      <Hero {...args} />
    </div>
  ),
};
