import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { LandingSaveSync } from "./LandingSaveSync";

const meta = {
  title: "Landing/Sections/SaveSync",
  component: LandingSaveSync,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Section 4 — the payoff: a journal notebook of a saved route on the left, headline + feature trio + magic-link save card (orange CTA) on the right, with the fox.",
      },
    },
  },
} satisfies Meta<typeof LandingSaveSync>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onOpenAuth: fn() },
};
