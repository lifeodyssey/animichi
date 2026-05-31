import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import SpotCard from "./SpotCard";
import { POINTS_UJI } from "@/stories/fixtures";

const meta = {
  title: "Spots/SpotCard",
  component: SpotCard,
  tags: ["autodocs"],
} satisfies Meta<typeof SpotCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrowseMode: Story = {
  args: {
    point: POINTS_UJI[0],
    mode: "browse",
  },
};

export const SelectModeUnselected: Story = {
  args: {
    point: POINTS_UJI[0],
    mode: "select",
    selected: false,
    onToggle: fn(),
  },
};

export const SelectModeSelected: Story = {
  args: {
    point: POINTS_UJI[0],
    mode: "select",
    selected: true,
    onToggle: fn(),
  },
};

export const NoImage: Story = {
  args: {
    point: { ...POINTS_UJI[1], screenshot_url: null },
    mode: "browse",
  },
};

export const BrokenImage: Story = {
  args: {
    point: { ...POINTS_UJI[0], screenshot_url: "https://broken.example/404.jpg" },
    mode: "browse",
  },
};

export const LongName: Story = {
  args: {
    point: {
      ...POINTS_UJI[0],
      name: "京都コンサートホール前の長い名前のスポット — ここは特に長い名前を持つ聖地巡礼スポットです",
    },
    mode: "browse",
  },
};

export const WithEpisodeBadge: Story = {
  args: {
    point: { ...POINTS_UJI[2], episode: 5 },
    mode: "browse",
  },
};
