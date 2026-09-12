import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoodCard } from "./MoodCard";

const meta = {
  title: "Chat/Cards/MoodCard",
  component: MoodCard,
  args: { mood: { quote: "ここから、はじまるんだ。", source: "— 響け！ユーフォニアム" } },
} satisfies Meta<typeof MoodCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Japanese: Story = {};
export const English: Story = { args: { mood: { quote: "This is where our journey begins.", source: "— Hibike! Euphonium" } }, globals: { locale: "en" } };
export const Chinese: Story = { args: { mood: { quote: "我们的旅程，就从这里开始。", source: "— 吹响吧！上低音号" } }, globals: { locale: "zh" } };
export const LongQuote: Story = { args: { mood: { quote: "いま見えている景色の向こうまで、ゆっくり歩いて、物語の続きを探しにいこう。", source: "— コンちゃん" } } };
export const HiddenWithoutMood: Story = { args: { mood: undefined } };
