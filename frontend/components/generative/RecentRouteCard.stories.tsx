import type { Meta, StoryObj } from "@storybook/react";
import { RecentRouteCard } from "./RecentRouteCard";

const meta = {
  title: "Generative/RecentRouteCard",
  component: RecentRouteCard,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Postage-stamp-style card for resuming a recent pilgrimage route. Shows torii stamp, vertical resume label, cover thumbnail, title, locations, and spot count. Used in history drawer (state 14).",
      },
    },
  },
  tags: ["autodocs"],
  decorators: [
    (Story: React.ComponentType) => (
      <div style={{ width: 360, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RecentRouteCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "響け！ユーフォニアム",
    locations: ["宇治市", "京都市"],
    spotCount: 8,
    updatedWhen: "昨日",
    thumbnailSrc: "/images/landing/hero-kimi-anitabi-real.jpg",
    onClick: () => console.log("card clicked"),
  },
};

export const NoThumbnail: Story = {
  name: "No thumbnail (placeholder)",
  args: {
    title: "君の名は。",
    locations: ["新宿"],
    spotCount: 5,
    updatedWhen: "3日前",
  },
};

export const ZeroSpots: Story = {
  name: "Zero spots (safe fallback)",
  args: {
    title: "ヴァイオレット・エヴァーガーデン",
    locations: ["京都市"],
    spotCount: 0,
    updatedWhen: "1週間前",
  },
};

export const SingleLocation: Story = {
  args: {
    title: "たまこまーけっと",
    locations: ["出町柳"],
    spotCount: 12,
    updatedWhen: "今日",
    thumbnailSrc: "/images/landing/hero-kimi-anitabi-real.jpg",
  },
};
