import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SelectionStoryProvider } from "../../../../.storybook/chat-cards/fixtures";
import { SelectionFlow } from "../../../../.storybook/chat-cards/SelectionFlow";
import { chatDictFor } from "../i18n";
import { SelectionTray } from "./SelectionTray";

const meta = {
  title: "Chat/Cards/SelectionTray",
  component: SelectionTray,
  args: { dict: chatDictFor("ja"), status: "idle", onRecompute: fn() },
  parameters: { layout: "fullscreen", chatViewport: "full" },
} satisfies Meta<typeof SelectionTray>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  render: (args) => <SelectionStoryProvider initial={["uji-bridge", "keihan-uji", "uji-shrine"]}><SelectionTray {...args} /></SelectionStoryProvider>,
};
export const BelowMinimum: Story = {
  render: (args) => <SelectionStoryProvider initial={["uji-bridge"]}><SelectionTray {...args} /></SelectionStoryProvider>,
};
export const FailedRetry: Story = {
  args: { status: "failed" },
  render: (args) => <SelectionStoryProvider initial={["uji-bridge", "keihan-uji"]}><SelectionTray {...args} /></SelectionStoryProvider>,
};
export const HiddenWhileBusy: Story = {
  args: { status: "busy" },
  render: (args) => <SelectionStoryProvider initial={["uji-bridge", "keihan-uji"]}><SelectionTray {...args} /></SelectionStoryProvider>,
};
export const HiddenAfterSent: Story = {
  args: { lastSentIds: ["uji-bridge", "keihan-uji"] },
  render: (args) => <SelectionStoryProvider initial={["uji-bridge", "keihan-uji"]}><SelectionTray {...args} /></SelectionStoryProvider>,
};
export const English: Story = { ...Ready, args: { dict: chatDictFor("en") }, globals: { locale: "en" } };
export const Chinese: Story = { ...Ready, args: { dict: chatDictFor("zh") }, globals: { locale: "zh" } };
export const Narrow: Story = { ...Ready, parameters: { chatViewport: "narrow" } };
export const NarrowEnglish: Story = { ...English, parameters: { chatViewport: "narrow" } };
export const FailedBelowMinimum: Story = { ...BelowMinimum, args: { status: "failed" } };
export const WithSearchAndComposer: Story = { render: (args) => <SelectionFlow {...args} /> };
