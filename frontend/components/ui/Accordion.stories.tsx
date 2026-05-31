import type { Meta, StoryObj } from "@storybook/react";
import { CollapseCard } from "./accordion";

const meta = {
  title: "UI/CollapseCard",
  component: CollapseCard,
  tags: ["autodocs"],
} satisfies Meta<typeof CollapseCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    question: "聖地巡礼とは？",
    answer: "アニメや漫画の舞台となった実在の場所を訪れる旅行スタイルです。作品のシーンと同じ場所で写真を撮ったり、作品の世界観を現地で体験できます。",
  },
};

export const Expanded: Story = {
  args: {
    question: "アクセス方法は？",
    answer: "JR奈良線「宇治駅」から徒歩約10分。または近鉄京都線「大久保駅」からバスで約15分です。",
    defaultExpanded: true,
  },
};

export const Disabled: Story = {
  args: {
    question: "準備中のコンテンツ",
    answer: "このコンテンツは現在準備中です。",
    disabled: true,
  },
};

export const FAQGroup: Story = {
  args: { question: "", answer: "" },
  render: () => (
    <div className="flex w-80 flex-col gap-2">
      <CollapseCard
        question="聖地巡礼とは？"
        answer="アニメや漫画の舞台となった実在の場所を訪れる旅行スタイルです。"
      />
      <CollapseCard
        question="どこから始めればいい？"
        answer="まず好きな作品を検索して、近くの聖地スポットを確認してみましょう。"
      />
      <CollapseCard
        question="訪問のヒント"
        answer="早朝が特におすすめです。夕暮れ時もドラマと同じ光景が楽しめます。"
      />
    </div>
  ),
};
