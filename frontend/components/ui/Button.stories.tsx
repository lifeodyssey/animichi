// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { Search, Heart, MapPin, Trash2, ExternalLink } from "lucide-react";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    type: {
      control: "select",
      options: ["primary", "default", "dashed", "text", "link"],
    },
    size: {
      control: "select",
      options: ["small", "middle", "large"],
    },
    danger: { control: "boolean" },
    ghost: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ── Types ── */

export const Primary: Story = {
  args: { type: "primary", children: "ルートを計画" },
};

export const Default: Story = {
  args: { type: "default", children: "聖地を探す" },
};

export const Dashed: Story = {
  args: { type: "dashed", children: "スポットを追加" },
};

export const TextType: Story = {
  name: "Text",
  args: { type: "text", children: "キャンセル" },
};

export const Link: Story = {
  args: { type: "link", children: "もっと見る" },
};

export const Ghost: Story = {
  args: { ghost: true, children: "詳細を見る" },
};

export const Danger: Story = {
  args: { danger: true, children: "削除する" },
};

export const DangerGhost: Story = {
  name: "Danger + Ghost",
  args: { danger: true, ghost: true, children: "削除する" },
};

/* ── Sizes ── */

export const Small: Story = {
  args: { size: "small", children: "保存" },
};

export const Middle: Story = {
  args: { size: "middle", children: "聖地巡礼を始める" },
};

export const Large: Story = {
  args: { size: "large", children: "聖地巡礼を始める" },
};

export const WithIcon: Story = {
  name: "With Icon Prop",
  args: {
    type: "primary",
    icon: <Search className="size-4" />,
    children: "検索",
  },
};

/* ── With children icons ── */

export const WithLeadingIcon: Story = {
  name: "With Leading Icon",
  args: {
    type: "primary",
    children: (
      <>
        <MapPin className="size-4" /> スポットを追加
      </>
    ),
  },
};

export const WithTrailingIcon: Story = {
  name: "With Trailing Icon",
  args: {
    type: "default",
    children: (
      <>
        Google Maps <ExternalLink className="size-3.5" />
      </>
    ),
  },
};

/* ── States ── */

export const Disabled: Story = {
  args: { type: "primary", children: "送信中…", disabled: true },
};

export const Loading: Story = {
  args: {
    type: "primary",
    loading: true,
    children: "Loading...",
  },
};

export const Block: Story = {
  args: {
    type: "primary",
    block: true,
    children: "全幅ボタン",
  },
};

/* ── Gallery ── */

export const AllTypes: Story = {
  name: "All Types",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="primary">Primary</Button>
      <Button type="default">Default</Button>
      <Button type="dashed">Dashed</Button>
      <Button type="text">Text</Button>
      <Button type="link">Link</Button>
      <Button ghost>Ghost</Button>
      <Button danger>
        <Trash2 className="size-4" /> Danger
      </Button>
    </div>
  ),
};

export const AllSizes: Story = {
  name: "All Sizes",
  render: () => (
    <div className="flex flex-wrap items-end gap-3">
      <Button size="small">small</Button>
      <Button size="middle">middle</Button>
      <Button size="large">large</Button>
      <Button type="default" icon={<Heart className="size-4" />} aria-label="Fav" />
    </div>
  ),
};
