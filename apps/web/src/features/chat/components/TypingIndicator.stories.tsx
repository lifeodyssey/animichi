import type { Meta, StoryObj } from "@storybook/react-vite";
import { chatDictFor } from "../i18n";
import { withChatLocale } from "../../../../.storybook/chat-chrome/story-helpers";
import { TypingIndicator } from "./TypingIndicator";

const meta = { title: "Chat/Streaming/TypingIndicator", component: TypingIndicator, decorators: [withChatLocale] } satisfies Meta<typeof TypingIndicator>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Thinking: Story = { args: { dict: chatDictFor("ja") } };
