import type { Meta, StoryObj } from "@storybook/react-vite";
import { chatDictFor } from "../i18n";
import { withChatLocale } from "../../../../.storybook/chat-chrome/story-helpers";
import { ToolStepBadge } from "./ToolStepBadge";

const meta = { title: "Chat/Streaming/ToolStepBadge", component: ToolStepBadge, decorators: [withChatLocale] } satisfies Meta<typeof ToolStepBadge>;
export default meta;
type Story = StoryObj<typeof meta>;
const base = { dict: chatDictFor("ja"), type: "tool-search_bangumi" } as const;
export const Running: Story = { args: { ...base, status: "running" } };
export const Done: Story = { args: { ...base, status: "done" } };
export const Error: Story = { args: { ...base, status: "error" } };
export const Retried: Story = { args: { ...base, status: "retried" } };
