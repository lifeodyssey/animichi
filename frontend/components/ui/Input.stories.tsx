// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { Search, MapPin, X } from "lucide-react";
import { Input } from "./input";

const meta = {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["small", "middle", "large"],
    },
    status: {
      control: "select",
      options: [undefined, "error", "warning"],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ── Basic ── */

export const Default: Story = {
  args: { placeholder: "アニメ名を入力..." },
};

export const WithValue: Story = {
  args: { defaultValue: "響け！ユーフォニアム" },
};

/* ── Sizes ── */

export const Small: Story = {
  args: { size: "small", placeholder: "Small input" },
};

export const Middle: Story = {
  args: { size: "middle", placeholder: "Middle input" },
};

export const Large: Story = {
  args: { size: "large", placeholder: "Large input" },
};

/* ── With prefix / suffix ── */

export const WithPrefix: Story = {
  name: "With Prefix Icon",
  args: {
    prefix: <Search className="size-4" />,
    placeholder: "聖地を検索...",
  },
};

export const WithSuffix: Story = {
  name: "With Suffix Icon",
  args: {
    suffix: <MapPin className="size-4" />,
    placeholder: "場所を入力...",
  },
};

export const WithPrefixAndSuffix: Story = {
  name: "With Prefix + Suffix",
  args: {
    prefix: <Search className="size-4" />,
    suffix: (
      <button type="button" className="hover:text-foreground transition-colors" aria-label="クリア">
        <X className="size-3.5" />
      </button>
    ),
    defaultValue: "京都",
  },
};

export const AllowClear: Story = {
  name: "Allow Clear",
  args: {
    allowClear: true,
    defaultValue: "京都府宇治市",
  },
};

/* ── Status ── */

export const Error: Story = {
  args: {
    status: "error",
    defaultValue: "invalid-email",
    placeholder: "メールアドレス",
  },
};

export const Warning: Story = {
  args: {
    status: "warning",
    defaultValue: "あいまいな検索",
    placeholder: "アニメ名",
  },
};

/* ── States ── */

export const Disabled: Story = {
  args: { placeholder: "入力不可", disabled: true },
};

export const SearchType: Story = {
  name: "type=search",
  args: { type: "search", placeholder: "聖地を検索" },
};

/* ── Gallery ── */

export const AllSizes: Story = {
  name: "All Sizes",
  render: () => (
    <div className="flex flex-col gap-3 max-w-sm">
      <Input size="small" placeholder="Small" prefix={<Search className="size-3.5" />} />
      <Input size="middle" placeholder="Middle" prefix={<Search className="size-4" />} />
      <Input size="large" placeholder="Large" prefix={<Search className="size-5" />} />
    </div>
  ),
};

export const AllStatuses: Story = {
  name: "All Statuses",
  render: () => (
    <div className="flex flex-col gap-3 max-w-sm">
      <Input placeholder="Normal" />
      <Input status="error" placeholder="Error" />
      <Input status="warning" placeholder="Warning" />
      <Input disabled placeholder="Disabled" />
    </div>
  ),
};
