import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import LandingPage from "./LandingPage";

const meta = {
  title: "Landing/Page",
  component: LandingPage,
  parameters: {
    layout: "fullscreen",
    // Target design attached via @storybook/addon-designs — shows in the "Design" tab.
    design: {
      type: "image",
      url: "/design-targets/landing-hero.png",
    },
  },
} satisfies Meta<typeof LandingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onOpenAuth: fn() },
};
