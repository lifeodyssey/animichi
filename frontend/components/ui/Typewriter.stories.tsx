import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Typewriter } from "./typewriter";

const meta = {
  title: "UI/Typewriter",
  component: Typewriter,
  tags: ["autodocs"],
} satisfies Meta<typeof Typewriter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "聖地巡礼の旅へようこそ！あなたの好きなアニメの舞台を一緒に探しましょう。",
  },
};

export const SlowSpeed: Story = {
  args: {
    children: "ゆっくり表示されるテキストです。",
    speed: 200,
  },
};

export const FastSpeed: Story = {
  args: {
    children: "高速で表示されるテキストです。サクサク読めますね。",
    speed: 30,
  },
};

export const WithElements: Story = {
  args: {
    children: (
      <p>
        <strong>響け！ユーフォニアム</strong>の舞台は
        <em>京都府宇治市</em>です。
      </p>
    ),
  },
};

export const NoAutoPlay: Story = {
  args: {
    children: "このテキストは最初からすべて表示されています。",
    autoPlay: false,
  },
};

function TypewriterWithTrigger() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      <Typewriter trigger={key} speed={60}>
        聖地巡礼の旅へようこそ！クリックで再生します。
      </Typewriter>
      <button
        className="w-fit rounded-[12px] border-2 border-border bg-card px-4 py-2 text-sm font-medium text-foreground"
        onClick={() => setKey((k) => k + 1)}
      >
        もう一度再生
      </button>
    </div>
  );
}

export const WithTrigger: Story = {
  render: () => <TypewriterWithTrigger />,
};
