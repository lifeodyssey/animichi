import type { Meta, StoryObj } from "@storybook/react";
import { LandingHowItWorks } from "./LandingHowItWorks";

const meta = {
  title: "Landing/Sections/HowItWorks",
  component: LandingHowItWorks,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Section 2 — the scene→place→plan journey. Four steps woven on a dashed route line, each with a colored marker and an evocative mini-preview, framed by pressed stamps and the fox guide.",
      },
    },
  },
} satisfies Meta<typeof LandingHowItWorks>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
