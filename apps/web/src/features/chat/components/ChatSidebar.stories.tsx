import type { Meta, StoryObj } from "@storybook/react-vite";
import { chatDictFor } from "../i18n";
import { withChatLocale } from "../../../../.storybook/chat-chrome/story-helpers";
import { ChatSidebar } from "./ChatSidebar";

const meta = { title: "Chat/Chrome/ChatSidebar", component: ChatSidebar, decorators: [withChatLocale], parameters: { chatViewport: "full" } } satisfies Meta<typeof ChatSidebar>;
export default meta;
type Story = StoryObj<typeof meta>;
const base = { dict: chatDictFor("ja"), baseUrl: "/storybook", activeSessionId: "kyoto" };
export const SignedInWithHistory: Story = { args: { ...base, status: "authenticated" } };
export const Anonymous: Story = { args: { ...base, status: "anonymous" } };
export const Pending: Story = { args: { ...base, status: "pending" } };
