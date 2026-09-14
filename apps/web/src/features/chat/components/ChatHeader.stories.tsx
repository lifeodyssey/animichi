import type { Meta, StoryObj } from "@storybook/react-vite";
import { chatDictFor } from "../i18n";
import { withChatLocale } from "../../../../.storybook/chat-chrome/story-helpers";
import { ChatHeader } from "./ChatHeader";

const meta = { title: "Chat/Chrome/ChatHeader", component: ChatHeader, decorators: [withChatLocale] } satisfies Meta<typeof ChatHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const JapaneseDefault: Story = { args: { dict: chatDictFor("ja") } };
export const WithTopic: Story = { args: { dict: chatDictFor("ja"), title: "響け！ユーフォニアムの宇治橋に行きたい" } };
export const Narrow: Story = { args: WithTopic.args, parameters: { chatViewport: "narrow" }, globals: { viewport: { value: "375-812", isRotated: false } } };
