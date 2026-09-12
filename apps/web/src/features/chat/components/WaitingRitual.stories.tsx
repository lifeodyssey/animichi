import type { Meta, StoryObj } from "@storybook/react-vite";
import { chatDictFor } from "../i18n";
import { withChatLocale } from "../../../../.storybook/chat-chrome/story-helpers";
import { LiveWaitingPreview, WaitingRitualPreview, WaitingWithMessage } from "../../../../.storybook/chat-chrome/WaitingRitualPreview";
import { WaitingFeedback } from "./WaitingRitual";

const meta = {
  title: "Chat/Streaming/WaitingRitual", component: WaitingFeedback, decorators: [withChatLocale],
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Quiet, localized feedback while a turn is submitted. Elapsed time adds one reassurance after 15 seconds; it never claims a search, route computation, percentage or estimated completion. No mascot, quote card, retry or cancel action. Deterministic presentation stories cover both states; Active uses the real timer. Message context is an authored frontend fixture, with no request or page changes." } } },
  globals: { locale: "zh" }, args: { dict: chatDictFor("zh"), phase: "waiting" },
  argTypes: { dict: { control: false }, phase: { control: "select", options: ["waiting", "extended"] } },
  render: (args) => <WaitingRitualPreview {...args} />,
} satisfies Meta<typeof WaitingFeedback>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const LongWait: Story = { args: { phase: "extended" } };
export const WithMessage: Story = { render: (args) => <WaitingWithMessage {...args} /> };
export const LongWaitWithMessage: Story = { ...WithMessage, args: { phase: "extended" } };
export const Active: Story = { render: ({ dict }) => <LiveWaitingPreview dict={dict} status="submitted" /> };
export const HiddenWhenReady: Story = { render: ({ dict }) => <LiveWaitingPreview dict={dict} status="ready" /> };
export const HiddenWhenStreaming: Story = { render: ({ dict }) => <LiveWaitingPreview dict={dict} status="streaming" /> };
export const HiddenWhenFailed: Story = { render: ({ dict }) => <LiveWaitingPreview dict={dict} status="error" /> };
export const Narrow: Story = { ...LongWaitWithMessage, parameters: { chatViewport: "component-narrow" } };
export const English: Story = { ...Narrow, globals: { locale: "en" } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" } };
