import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { userEvent, within } from "storybook/test";
import { Select } from "./select";

const meta = {
  title: "UI/Select",
  component: Select,
  tags: ["autodocs"],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const regionOptions = [
  { key: "kyoto", label: "京都府" },
  { key: "tokyo", label: "東京都" },
  { key: "saitama", label: "埼玉県" },
  { key: "kanagawa", label: "神奈川県" },
];

function SelectDefault() {
  const [value, setValue] = useState("");
  return (
    <Select
      options={regionOptions}
      value={value}
      onChange={setValue}
      placeholder="地域を選択"
    />
  );
}

export const Default: Story = {
  args: { options: [] },
  render: () => <SelectDefault />,
};

function SelectWithValue() {
  const [value, setValue] = useState("kyoto");
  return (
    <Select
      options={regionOptions}
      value={value}
      onChange={setValue}
    />
  );
}

export const WithValue: Story = {
  args: { options: [] },
  render: () => <SelectWithValue />,
};

export const Disabled: Story = {
  args: { options: [] },
  render: () => (
    <Select
      options={regionOptions}
      value="kyoto"
      onChange={() => {}}
      disabled
    />
  ),
};

const prefectures = [
  { key: "hokkaido", label: "北海道" },
  { key: "aomori", label: "青森県" },
  { key: "iwate", label: "岩手県" },
  { key: "miyagi", label: "宮城県" },
  { key: "akita", label: "秋田県" },
  { key: "yamagata", label: "山形県" },
  { key: "fukushima", label: "福島県" },
  { key: "tokyo", label: "東京都" },
];

function SelectMany() {
  const [value, setValue] = useState("");
  return (
    <Select
      options={prefectures}
      value={value}
      onChange={setValue}
      placeholder="都道府県を選択"
    />
  );
}

export const ManyOptions: Story = {
  args: { options: [] },
  render: () => <SelectMany />,
};

/** Open — shows the soft yellow (#FFEEA0) dropdown panel */
export const Open: Story = {
  args: { options: [] },
  render: () => <SelectDefault />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByText("地域を選択");
    await userEvent.click(trigger);
  },
};
