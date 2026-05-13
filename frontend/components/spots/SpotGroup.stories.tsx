import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import SpotGroup from "./SpotGroup";
import { POINTS_UJI, POINTS_MANY } from "@/stories/fixtures";

const meta = {
  title: "Spots/SpotGroup",
  component: SpotGroup,
  tags: ["autodocs"],
  args: {
    title: "響け！ユーフォニアム",
    count: POINTS_UJI.length,
    points: POINTS_UJI,
    onToggle: fn(),
  },
} satisfies Meta<typeof SpotGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrowseMode: Story = {
  args: {
    selectedIds: undefined,
    onToggle: undefined,
  },
};

export const SelectMode: Story = {
  args: {
    selectedIds: new Set(["p1", "p3"]),
    onToggle: fn(),
  },
};

export const DefaultOpen: Story = {
  args: {
    defaultOpen: true,
    selectedIds: new Set(),
    onToggle: fn(),
  },
};

export const ManyPoints: Story = {
  name: "ManyPoints (show-all button)",
  args: {
    title: "大量スポット",
    count: POINTS_MANY.length,
    points: POINTS_MANY,
    defaultOpen: true,
    selectedIds: new Set(),
    onToggle: fn(),
    showAllLabel: "全{count}件を表示",
  },
};

export const NoThumbnail: Story = {
  args: {
    points: POINTS_UJI.map((p) => ({ ...p, screenshot_url: null })),
    selectedIds: new Set(),
    onToggle: fn(),
  },
};
