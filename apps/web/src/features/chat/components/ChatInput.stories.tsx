import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { chatDictFor } from "../i18n";
import { withChatLocale } from "../../../../.storybook/chat-chrome/story-helpers";
import { ChatInput } from "./ChatInput";

const meta = { title: "Chat/Composer/ChatInput", component: ChatInput, decorators: [withChatLocale] } satisfies Meta<typeof ChatInput>;
export default meta;
type Story = StoryObj<typeof meta>;
const base = { dict: chatDictFor("ja"), disabled: false, onSend: fn() };
export const Empty: Story = { args: base };
export const Busy: Story = { args: { ...base, busy: true } };
export const QuotaLocked: Story = { args: { ...base, quotaLocked: true } };
export const Disabled: Story = { args: { ...base, disabled: true } };
export const Narrow: Story = { args: base, parameters: { chatViewport: "narrow" }, globals: { viewport: { value: "375-812", isRotated: false } } };
