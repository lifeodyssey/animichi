import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import Clarification from "./Clarification";

const meta = {
  title: "Generative/Clarification",
  component: Clarification,
  tags: ["autodocs"],
  args: { onSuggest: fn() },
} satisfies Meta<typeof Clarification>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithCandidates: Story = {
  args: {
    message: "複数の作品が見つかりました。どちらをお探しですか？",
    candidates: [
      { title: "響け！ユーフォニアム", cover_url: "https://image.anitabi.cn/bangumi/51.jpg", spot_count: 12, city: "宇治" },
      { title: "響け！ユーフォニアム2", cover_url: "https://image.anitabi.cn/bangumi/140001.jpg", spot_count: 8, city: "宇治" },
      { title: "リズと青い鳥", cover_url: "https://image.anitabi.cn/bangumi/207879.jpg", spot_count: 5, city: "宇治" },
    ],
  },
};

export const WithOptions: Story = {
  args: {
    message: "以下のどちらをお探しですか？",
    options: ["響け！ユーフォニアム", "リズと青い鳥", "小玉ユフィ"],
  },
};

export const NoImageCandidates: Story = {
  args: {
    message: "いくつか候補が見つかりました。",
    candidates: [
      { title: "君の名は。", cover_url: null, spot_count: 20, city: "東京" },
      { title: "言の葉の庭", cover_url: null, spot_count: 7, city: "東京" },
    ],
  },
};

export const FallbackSuggestions: Story = {
  args: {
    message: "聖地をお探しですか？以下から選んでください。",
  },
};

export const LongTitles: Story = {
  args: {
    message: "似た名前の作品が複数見つかりました。",
    candidates: [
      { title: "劇場版 響け！ユーフォニアム〜誓いのフィナーレ〜", cover_url: null, spot_count: 6, city: "宇治" },
      { title: "劇場版 響け！ユーフォニアム〜届けたいメロディ〜", cover_url: null, spot_count: 4, city: "宇治" },
    ],
  },
};
