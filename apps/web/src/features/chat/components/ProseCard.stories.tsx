import type { Meta, StoryObj } from "@storybook/react-vite";
import { chatDictFor } from "../i18n";
import { DataPartCard } from "./DataPartCard";

const meta = {
  title: "Chat/Cards/ProseCard",
  component: DataPartCard,
  args: {
    data: { intent: "general_qa", success: true, status: "ok", message: "まずは宇治駅から、川沿いをゆっくり歩くのがおすすめです。" },
    dict: chatDictFor("ja"),
  },
} satisfies Meta<typeof DataPartCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Japanese: Story = {};
export const LongText: Story = {
  args: { data: { intent: "general_qa", success: true, message: "朝の宇治は川沿いの光がやわらかく、歩きやすい時間です。駅から宇治橋へ進み、混雑を避けながら作品の場面と同じ方向を確かめてみましょう。途中で休める場所も含めて、無理のない順番で案内します。" } },
};
export const English: Story = { args: { data: { intent: "general_qa", success: true, message: "Start at Uji Station and follow the river at an easy pace." }, dict: chatDictFor("en") }, globals: { locale: "en" } };
export const Chinese: Story = { args: { data: { intent: "general_qa", success: true, message: "建议从宇治站出发，沿河慢慢走。" }, dict: chatDictFor("zh") }, globals: { locale: "zh" } };
