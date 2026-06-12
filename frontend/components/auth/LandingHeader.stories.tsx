import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import LandingHeader from "./LandingHeader";

const meta = {
  title: "Landing/Header",
  component: LandingHeader,
  parameters: {
    layout: "fullscreen",
    // Design tab: the floating pill header (torii+fox logo + game-yellow Login),
    // cropped from the live build.
    design: { type: "image", url: "/design-targets/landing-hero-header.png" },
  },
  // Float the cream pill on the page ground so the header reads as the surface layer.
  decorators: [
    (Story) => (
      <div style={{ background: "var(--animal-bg-color)", minHeight: 200 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LandingHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Brand lockup left, game-yellow Login pill right. */
export const Default: Story = {
  args: { onLogin: fn() },
};
