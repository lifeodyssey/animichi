import type { Meta, StoryObj } from "@storybook/react";
import { Search, Heart, MapPin, Trash2, ExternalLink } from "lucide-react";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "default", "cta", "outline", "ghost", "link", "chip", "danger"],
    },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "icon"],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ── Variants ── */

export const Primary: Story = {
  args: { variant: "primary", children: "ルートを計画" },
};

export const CTA: Story = {
  args: { variant: "cta", children: "確認する" },
};

export const Default: Story = {
  args: { variant: "default", children: "聖地を探す" },
};

export const Outline: Story = {
  args: { variant: "outline", children: "詳細を見る" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "キャンセル" },
};

export const Link: Story = {
  args: { variant: "link", children: "もっと見る" },
};

export const Chip: Story = {
  args: { variant: "chip", children: "京都府", "aria-pressed": false },
};

export const ChipActive: Story = {
  name: "Chip (Active)",
  args: { variant: "chip", children: "宇治市", "aria-pressed": true },
};

export const Danger: Story = {
  args: { variant: "danger", children: "削除する" },
};

/* ── Sizes ── */

export const ExtraSmall: Story = {
  args: { size: "xs", children: "保存" },
};

export const Small: Story = {
  args: { size: "sm", children: "保存" },
};

export const Medium: Story = {
  args: { size: "md", children: "聖地巡礼を始める" },
};

export const Large: Story = {
  args: { size: "lg", children: "聖地巡礼を始める" },
};

export const Icon: Story = {
  args: {
    size: "icon",
    variant: "outline",
    children: <Search className="size-4" />,
    "aria-label": "検索",
  },
};

/* ── With Icons ── */

export const WithLeadingIcon: Story = {
  name: "With Leading Icon",
  args: {
    variant: "primary",
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
    variant: "outline",
    children: (
      <>
        Google Maps <ExternalLink className="size-3.5" />
      </>
    ),
  },
};

/* ── States ── */

export const Disabled: Story = {
  args: { variant: "primary", children: "送信中…", disabled: true },
};

export const DisabledDanger: Story = {
  name: "Disabled (Danger)",
  args: { variant: "danger", children: "削除する", disabled: true },
};

/* ── Gallery ── */

export const AllVariants: Story = {
  name: "All Variants",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="cta">CTA 確認</Button>
      <Button variant="default">Default</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
      <Button variant="chip">Chip</Button>
      <Button variant="danger">
        <Trash2 className="size-4" /> Danger
      </Button>
    </div>
  ),
};

export const AllSizes: Story = {
  name: "All Sizes",
  render: () => (
    <div className="flex flex-wrap items-end gap-3">
      <Button size="xs">xs</Button>
      <Button size="sm">sm</Button>
      <Button size="md">md</Button>
      <Button size="lg">lg</Button>
      <Button size="icon" variant="outline" aria-label="Fav">
        <Heart className="size-4" />
      </Button>
    </div>
  ),
};
