import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import LandingPage from "./LandingPage";

const meta = {
  title: "Landing/Page",
  component: LandingPage,
  parameters: {
    layout: "fullscreen",
    // Design tab (@storybook/addon-designs): the full assembled homepage, cropped
    // from the live animal-island build (clean #f8f8f0 ground, Nunito-800 headline,
    // pastel chips, yellow Login). Re-crop via the design-targets pipeline if the
    // page changes — it doubles as a visual-regression baseline.
    design: { type: "image", url: "/design-targets/landing-hero.png" },
  },
} satisfies Meta<typeof LandingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The whole homepage: pill header → hero band → footer. */
export const Default: Story = {
  args: { onOpenAuth: fn() },
};
