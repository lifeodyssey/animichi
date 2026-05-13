import type { Meta, StoryObj } from "@storybook/react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./accordion";

const meta = {
  title: "UI/Accordion",
  component: Accordion,
  tags: ["autodocs"],
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Accordion className="w-80">
      <AccordionItem value="access">
        <AccordionTrigger>アクセス方法</AccordionTrigger>
        <AccordionContent>
          JR奈良線「宇治駅」から徒歩約10分。または近鉄京都線「大久保駅」からバス。
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="scenes">
        <AccordionTrigger>登場シーン</AccordionTrigger>
        <AccordionContent>
          「響け！ユーフォニアム」第1話・第12話の冒頭シーンに登場します。
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="tips">
        <AccordionTrigger>訪問のヒント</AccordionTrigger>
        <AccordionContent>
          早朝が特におすすめです。夕暮れ時もドラマと同じ光景が楽しめます。
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const OpenByDefault: Story = {
  render: () => (
    <Accordion className="w-80" defaultValue={["access"]}>
      <AccordionItem value="access">
        <AccordionTrigger>アクセス方法</AccordionTrigger>
        <AccordionContent>
          JR宇治駅から徒歩10分。周辺に駐車場あり。
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="hours">
        <AccordionTrigger>営業時間</AccordionTrigger>
        <AccordionContent>
          9:00〜17:00（拝観受付は16:45まで）
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const MultipleOpen: Story = {
  render: () => (
    <Accordion className="w-80" multiple>
      <AccordionItem value="q1">
        <AccordionTrigger>聖地巡礼とは？</AccordionTrigger>
        <AccordionContent>
          アニメや漫画の舞台となった実在の場所を訪れる旅行スタイルです。
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="q2">
        <AccordionTrigger>どこから始めればいい？</AccordionTrigger>
        <AccordionContent>
          まず好きな作品を検索して、近くの聖地スポットを確認してみましょう。
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
