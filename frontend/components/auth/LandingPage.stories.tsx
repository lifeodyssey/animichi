import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import LandingPage from "./LandingPage";

const meta = {
  title: "Auth/LandingPage",
  component: LandingPage,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    onOpenAuth: fn(),
  },
} satisfies Meta<typeof LandingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
