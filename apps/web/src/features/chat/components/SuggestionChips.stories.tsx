import type { Meta, StoryObj } from "@storybook/react-vite";
import { chatDictFor } from "../i18n";
import { SuggestionChips } from "./SuggestionChips";

const meta = {
  title: "Chat/Cards/SuggestionChips",
  component: SuggestionChips,
  args: { dict: chatDictFor("ja"), onPick: () => undefined },
} satisfies Meta<typeof SuggestionChips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Japanese: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const English: Story = { args: { dict: chatDictFor("en") }, globals: { locale: "en" } };
export const Chinese: Story = { args: { dict: chatDictFor("zh") }, globals: { locale: "zh" } };
export const LongText: Story = {
  args: { dict: { ...chatDictFor("ja"), chips: [
    { text: "京都と宇治を一日でめぐる、移動時間を含めた聖地巡礼ルートを組んで", kind: "example" },
    { text: "君の名は。のルートを組んで", kind: "example" },
    { text: "近くの聖地をさがして", kind: "nearbySearch" },
  ] } },
};
