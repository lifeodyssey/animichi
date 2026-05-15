import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import ChatInputV2 from "./ChatInputV2";

const meta = {
  title: "Chat/ChatInputV2",
  component: ChatInputV2,
  tags: ["autodocs"],
  args: {
    onSend: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ background: "var(--color-bg)", minHeight: 200, display: "flex", alignItems: "end" }}>
        <div style={{ width: "100%" }}>
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof ChatInputV2>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default — search bar style, empty state */
export const Default: Story = {};

/** Disabled — breathing dots loading indicator */
export const Disabled: Story = {
  args: { disabled: true },
};

/** Custom placeholder — Japanese anime name */
export const CustomPlaceholder: Story = {
  args: { placeholderOverride: "響け！ユーフォニアム の聖地を探す…" },
};

/** Chinese placeholder */
export const Chinese: Story = {
  args: { placeholderOverride: "输入动漫名称，或描述你的巡礼计划…" },
};

/** English placeholder */
export const English: Story = {
  args: { placeholderOverride: "Type an anime name, or describe your trip…" },
};

/** Long text — tests overflow with a very long placeholder */
export const LongText: Story = {
  args: {
    placeholderOverride: "これは非常に長いプレースホルダーテキストです。入力欄がどのように表示されるかをテストするために使用します。溢れた場合の表示を確認してください。",
  },
};

/** Dark background context — simulates overlay on hero */
export const OnDarkBackground: Story = {
  decorators: [
    (Story: React.ComponentType) => (
      <div
        style={{
          background: "rgba(61, 52, 40, 0.9)",
          minHeight: 200,
          display: "flex",
          alignItems: "end",
        }}
      >
        <div style={{ width: "100%" }}>
          <Story />
        </div>
      </div>
    ),
  ],
};
