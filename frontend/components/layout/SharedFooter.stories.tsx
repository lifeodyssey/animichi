import type { Meta, StoryObj } from "@storybook/react";
import SharedFooter from "./SharedFooter";

const meta = {
  title: "Layout/SharedFooter",
  component: SharedFooter,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Site footer — a quiet brand row (leaf sprig + 聖地巡礼 wordmark) with a language-cycle toggle (日本語 / 中文 / English). Locale is driven by the i18n context.",
      },
    },
  },
} satisfies Meta<typeof SharedFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
