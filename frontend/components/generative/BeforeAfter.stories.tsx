import type { Meta, StoryObj } from "@storybook/react";
import BeforeAfter from "./BeforeAfter";

const meta = {
  title: "Generative/BeforeAfter",
  component: BeforeAfter,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof BeforeAfter>;

export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Fixtures — use public assets already in the repo
// ---------------------------------------------------------------------------

const ANIME_SRC = "/images/landing/hero-kimi-banbi-reference.jpg";
const REAL_SRC = "/images/landing/hero-kimi-anitabi-real.jpg";

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export const Default: Story = {
  name: "Default (static split)",
  args: {
    leftSrc: ANIME_SRC,
    rightSrc: REAL_SRC,
    leftAlt: "Your Name anime screenshot",
    rightAlt: "Suga Shrine real photo",
    leftLabel: "Anime",
    rightLabel: "Real",
  },
};

export const JapaneseBadges: Story = {
  name: "Japanese badges (アニメ / 実景)",
  args: {
    leftSrc: ANIME_SRC,
    rightSrc: REAL_SRC,
    leftAlt: "アニメスクリーンショット",
    rightAlt: "実写写真",
    leftLabel: "アニメ",
    rightLabel: "実景",
  },
};

export const ChineseBadges: Story = {
  name: "Chinese badges (动画 / 实景)",
  args: {
    leftSrc: ANIME_SRC,
    rightSrc: REAL_SRC,
    leftAlt: "动画截图",
    rightAlt: "实景照片",
    leftLabel: "动画",
    rightLabel: "实景",
  },
};

export const DraggableMode: Story = {
  name: "Draggable mode",
  args: {
    leftSrc: ANIME_SRC,
    rightSrc: REAL_SRC,
    leftAlt: "Your Name anime screenshot",
    rightAlt: "Suga Shrine real photo",
    leftLabel: "アニメ",
    rightLabel: "実景",
    draggable: true,
  },
};

export const AnimeOnly: Story = {
  name: "Anime only (no real photo)",
  args: {
    leftSrc: ANIME_SRC,
    rightSrc: "",
    leftAlt: "Anime screenshot",
    rightAlt: "",
    leftLabel: "Anime",
    rightLabel: "Real",
  },
};

export const BothBroken: Story = {
  name: "Both images broken",
  args: {
    leftSrc: "/nonexistent-anime.jpg",
    rightSrc: "/nonexistent-real.jpg",
    leftAlt: "Anime screenshot",
    rightAlt: "Real photo",
    leftLabel: "アニメ",
    rightLabel: "実景",
  },
};

export const LongAltText: Story = {
  name: "Long alt text",
  args: {
    leftSrc: ANIME_SRC,
    rightSrc: REAL_SRC,
    leftAlt:
      "君の名は。第3話 須賀神社の石段を登るシーン — アニメスクリーンショット",
    rightAlt:
      "須賀神社（東京都新宿区）実写写真 — 君の名は。聖地巡礼スポット",
    leftLabel: "アニメ",
    rightLabel: "実景",
  },
};

export const NoBadges: Story = {
  name: "No badges (labels omitted)",
  args: {
    leftSrc: ANIME_SRC,
    rightSrc: REAL_SRC,
    leftAlt: "Anime screenshot",
    rightAlt: "Real photo",
  },
};

export const MobileWidth: Story = {
  name: "Mobile width (375px)",
  args: {
    leftSrc: ANIME_SRC,
    rightSrc: REAL_SRC,
    leftLabel: "アニメ",
    rightLabel: "実景",
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};
