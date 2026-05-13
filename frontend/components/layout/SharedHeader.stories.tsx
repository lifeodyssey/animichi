import type { Meta, StoryObj, Decorator } from "@storybook/react";
import { fn } from "storybook/test";
import SharedHeader from "./SharedHeader";

const meta = {
  title: "Layout/SharedHeader",
  component: SharedHeader,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SharedHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLoginCallback: Story = {
  args: { onLogin: fn() },
};

export const WithLoginHref: Story = {
  args: { loginHref: "/login" },
};

export const WithNavItems: Story = {
  args: {
    loginHref: "/login",
    navItems: [
      { label: "ガイド", href: "/guide", active: true },
      { label: "よくある質問", href: "/faq" },
    ],
  },
};

export const WithChildren: Story = {
  args: {
    children: (
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          設定
        </button>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg"
        >
          新規チャット
        </button>
      </div>
    ),
  },
};

export const FixedPosition: Story = {
  args: { onLogin: fn(), position: "fixed" },
  decorators: [
    ((Story) => (
      <div className="h-[200px] overflow-y-scroll bg-background">
        <Story />
        <div className="mt-16 px-8 text-sm text-muted-foreground">
          Scroll content below the fixed header…
        </div>
      </div>
    )) satisfies Decorator,
  ],
};
