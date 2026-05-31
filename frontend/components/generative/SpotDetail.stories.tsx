import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import SpotDetail from "./SpotDetail";
import { POINTS_UJI, POINTS_MIXED_AREAS } from "@/stories/fixtures";

const meta = {
  title: "Generative/SpotDetail",
  component: SpotDetail,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    onBack: fn(),
    onSelect: fn(),
    isSelected: false,
  },
} satisfies Meta<typeof SpotDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    point: POINTS_UJI[0],
    nearbyPoints: POINTS_UJI,
  },
};

export const WithRealPhoto: Story = {
  args: {
    point: {
      ...POINTS_UJI[0],
      real_photo_url: "/images/landing/kimi-stairs-comparison-vertical-v2.jpg",
    },
    nearbyPoints: POINTS_UJI,
  },
};

export const AnimeOnly: Story = {
  args: {
    point: { ...POINTS_UJI[0], real_photo_url: null },
    nearbyPoints: POINTS_UJI,
  },
};

export const Selected: Story = {
  args: {
    point: POINTS_UJI[0],
    isSelected: true,
    nearbyPoints: POINTS_UJI,
  },
};

export const NoImage: Story = {
  args: {
    point: { ...POINTS_UJI[1], screenshot_url: null, real_photo_url: null },
    nearbyPoints: POINTS_UJI,
  },
};

export const WithNearbyMixedAreas: Story = {
  args: {
    point: POINTS_MIXED_AREAS[5],
    nearbyPoints: POINTS_MIXED_AREAS,
  },
};

export const NoNearby: Story = {
  args: {
    point: POINTS_UJI[0],
    nearbyPoints: [],
  },
};
