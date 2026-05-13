import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import WelcomeScreen from "./WelcomeScreen";
import type { Dict, Locale } from "../../lib/i18n";
import jaDict from "../../lib/dictionaries/ja.json";
import enDict from "../../lib/dictionaries/en.json";
import zhDict from "../../lib/dictionaries/zh.json";

const meta = {
  title: "Chat/WelcomeScreen",
  component: WelcomeScreen,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    onSend: fn(),
    dict: jaDict as unknown as Dict,
    locale: "ja" as Locale,
  },
} satisfies Meta<typeof WelcomeScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Japanese: Story = {};

export const English: Story = {
  args: {
    dict: enDict as unknown as Dict,
    locale: "en" as Locale,
  },
};

export const Chinese: Story = {
  args: {
    dict: zhDict as unknown as Dict,
    locale: "zh" as Locale,
  },
};
