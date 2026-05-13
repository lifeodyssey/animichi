import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { PhotoCard } from "./PhotoCard";
import { POINTS_UJI } from "@/stories/fixtures";

const meta = {
  title: "Generative/PhotoCard",
  component: PhotoCard,
  tags: ["autodocs"],
  args: {
    onToggle: fn(),
    onDetail: fn(),
    selected: false,
  },
} satisfies Meta<typeof PhotoCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { point: POINTS_UJI[0] },
};

export const Selected: Story = {
  args: { point: POINTS_UJI[0], selected: true },
};

export const NoImage: Story = {
  args: {
    point: { ...POINTS_UJI[1], screenshot_url: null },
  },
};

export const NoEpisode: Story = {
  args: {
    point: { ...POINTS_UJI[2], episode: null },
  },
};

export const LongName: Story = {
  args: {
    point: {
      ...POINTS_UJI[3],
      name: "北宇治高校吹奏楽部の練習場所として有名なロケ地",
      title: "響け！ユーフォニアム（長いタイトルのテスト用）",
    },
  },
};
