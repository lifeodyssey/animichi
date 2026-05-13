import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import RouteConfirm from "./RouteConfirm";
import { POINTS_UJI, POINTS_MIXED_AREAS } from "@/stories/fixtures";

const meta = {
  title: "Generative/RouteConfirm",
  component: RouteConfirm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    defaultOrigin: "京都駅",
    onConfirm: fn(),
    onBack: fn(),
  },
} satisfies Meta<typeof RouteConfirm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { points: POINTS_UJI },
};

export const ManyPoints: Story = {
  args: { points: POINTS_MIXED_AREAS },
};

export const TwoPoints: Story = {
  args: { points: POINTS_UJI.slice(0, 2) },
};

export const SinglePoint: Story = {
  name: "SinglePoint (confirm disabled)",
  args: { points: POINTS_UJI.slice(0, 1) },
};

export const EmptyList: Story = {
  name: "EmptyList (no items)",
  args: { points: [] },
};
