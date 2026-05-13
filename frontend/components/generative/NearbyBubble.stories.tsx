import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import NearbyBubble from "./NearbyBubble";
import { POINTS_MIXED_AREAS, POINTS_UJI } from "@/stories/fixtures";
import type { SearchResultData } from "@/lib/types";

const meta = {
  title: "Generative/NearbyBubble",
  component: NearbyBubble,
  tags: ["autodocs"],
  args: { onSuggest: fn() },
} satisfies Meta<typeof NearbyBubble>;

export default meta;
type Story = StoryObj<typeof meta>;

function makeNearbyData(overrides?: Partial<SearchResultData["results"]>): SearchResultData {
  return {
    message: "近くの聖地が見つかりました",
    status: "ok",
    results: {
      rows: POINTS_MIXED_AREAS,
      row_count: POINTS_MIXED_AREAS.length,
      strategy: "geo",
      status: "ok",
      metadata: { radius_m: 1000 },
      nearby_groups: [
        { bangumi_id: "51", title: "響け！ユーフォニアム", cover_url: "https://image.anitabi.cn/bangumi/51.jpg", points_count: 5, closest_distance_m: 120 },
        { bangumi_id: "317", title: "君の名は。", cover_url: "https://image.anitabi.cn/bangumi/317.jpg", points_count: 2, closest_distance_m: 650 },
      ],
      ...overrides,
    },
  };
}

export const WithBackendGroups: Story = {
  args: { data: makeNearbyData() },
};

export const FallbackFromPoints: Story = {
  name: "FallbackFromPoints (no nearby_groups)",
  args: {
    data: makeNearbyData({ nearby_groups: [] }),
  },
};

export const SingleGroup: Story = {
  args: {
    data: makeNearbyData({
      nearby_groups: [
        { bangumi_id: "51", title: "響け！ユーフォニアム", cover_url: null, points_count: 3, closest_distance_m: 80 },
      ],
    }),
  },
};

export const LargeRadius: Story = {
  args: {
    data: makeNearbyData({ metadata: { radius_m: 5000 } }),
  },
};

export const OnlyUjiPoints: Story = {
  args: {
    data: {
      message: "近くの聖地",
      status: "ok",
      results: {
        rows: POINTS_UJI,
        row_count: POINTS_UJI.length,
        strategy: "geo",
        status: "ok",
        metadata: { radius_m: 500 },
        nearby_groups: [
          { bangumi_id: "51", title: "響け！ユーフォニアム", cover_url: null, points_count: POINTS_UJI.length, closest_distance_m: 50 },
        ],
      },
    },
  },
};
