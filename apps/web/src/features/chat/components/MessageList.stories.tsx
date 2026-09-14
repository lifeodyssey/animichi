import type { Meta, StoryObj } from "@storybook/react-vite";
import { chatDictFor } from "../i18n";
import { withChatLocale } from "../../../../.storybook/chat-chrome/story-helpers";
import { MessageList } from "./MessageList";
import { ConversationPreview, ConversationSurface } from "../../../../.storybook/chat-streaming/ConversationPreview";
import { clarifyMessages, conversationMessages, retriedMessages, textMessages, toolMessages } from "../../../../.storybook/chat-streaming/fixtures";

const meta = {
  title: "Chat/Streaming/MessageList", component: MessageList,
  decorators: [withChatLocale, (Story) => <ConversationSurface><Story /></ConversationSurface>],
  args: { dict: chatDictFor("ja"), messages: [], status: "ready", settledDurationMs: 3200 },
} satisfies Meta<typeof MessageList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SettledText: Story = { render: (args) => <MessageList {...args} messages={textMessages(args.dict.locale)} /> };
export const SettledToolFootprint: Story = { render: (args) => <MessageList {...args} messages={toolMessages(args.dict.locale)} /> };
export const StreamingTool: Story = { args: { status: "streaming" }, render: (args) => <MessageList {...args} messages={toolMessages(args.dict.locale, "input-available")} /> };
export const Retried: Story = { render: (args) => <MessageList {...args} messages={retriedMessages(args.dict.locale)} /> };
export const FailedStep: Story = { args: { status: "error" }, render: (args) => <MessageList {...args} messages={toolMessages(args.dict.locale, "output-error")} /> };
export const Conversation: Story = { render: (args) => <ConversationPreview {...args} messages={conversationMessages(args.dict.locale)} /> };
export const WithClarifyCard: Story = { render: (args) => <ConversationPreview {...args} messages={clarifyMessages(args.dict.locale)} /> };
export const Narrow: Story = { ...Conversation, parameters: { chatViewport: "narrow" } };
export const NarrowEnglish: Story = { ...Narrow, globals: { locale: "en" } };
export const Empty: Story = {};
