// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { fn } from "storybook/test";
import { SearchBar } from "./search-bar";

const meta = {
  title: "UI/SearchBar",
  component: SearchBar,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof SearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

function SearchBarDemo({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <div className="w-[420px] max-w-full">
      <SearchBar
        value={value}
        onValueChange={setValue}
        onSubmit={fn()}
        placeholder="アニメのタイトルを入力"
        ctaLabel="探す"
      />
    </div>
  );
}

export const Default: Story = {
  args: {
    value: "",
    onValueChange: fn(),
    onSubmit: fn(),
    ctaLabel: "探す",
  },
  render: () => <SearchBarDemo />,
};

export const WithValue: Story = {
  args: {
    value: "",
    onValueChange: fn(),
    onSubmit: fn(),
    ctaLabel: "探す",
  },
  render: () => <SearchBarDemo initialValue="ゆるキャン△" />,
};
