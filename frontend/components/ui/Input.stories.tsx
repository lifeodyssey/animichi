import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./input";

const meta = {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { placeholder: "アニメ名を入力…" },
};

export const WithValue: Story = {
  args: { defaultValue: "ユーフォニアム" },
};

export const Search: Story = {
  args: { type: "search", placeholder: "聖地を検索" },
};

export const Disabled: Story = {
  args: { placeholder: "入力不可", disabled: true },
};

export const Invalid: Story = {
  args: { placeholder: "必須項目", "aria-invalid": true },
};
