import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { LandingPopularRoutes } from "./LandingPopularRoutes";
import type { AnimeGalleryItem } from "./LandingData";

const meta = {
  title: "Landing/Sections/PopularRoutes",
  component: LandingPopularRoutes,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Section 3 — fan-loved routes as journal cards (scene seam, place tag, route line, tags) plus a browse-before-login banner with the traveling fox.",
      },
    },
  },
} satisfies Meta<typeof LandingPopularRoutes>;

export default meta;
type Story = StoryObj<typeof meta>;

const ITEMS: AnimeGalleryItem[] = [
  { bangumiId: "115908", title: "君の名は。", count: "89 spots · 新宿" },
  { bangumiId: "160209", title: "響け！ユーフォニアム", count: "156 spots · 宇治" },
  { bangumiId: "269235", title: "天気の子", count: "72 spots · 東京" },
  { bangumiId: "328609", title: "ぼっち・ざ・ろっく！", count: "45 spots · 下北沢" },
];

export const Default: Story = {
  args: { items: ITEMS, onOpenAuth: fn() },
};

export const Empty: Story = {
  args: { items: [], onOpenAuth: fn() },
};
