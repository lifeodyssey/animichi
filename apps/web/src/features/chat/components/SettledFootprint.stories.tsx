import type { Meta, StoryObj } from "@storybook/react-vite";
import { chatDictFor } from "../i18n";
import { withChatLocale } from "../../../../.storybook/chat-chrome/story-helpers";
import { SettledFootprint } from "./SettledFootprint";
import { ToolStepBadge } from "./ToolStepBadge";

const meta = { title: "Chat/Streaming/SettledFootprint", component: SettledFootprint, decorators: [withChatLocale] } satisfies Meta<typeof SettledFootprint>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Collapsed: Story = { args: { dict: chatDictFor("ja"), elapsedLabel: "3.2s", children: null }, render: (args) => <SettledFootprint {...args}><ToolStepBadge dict={args.dict} type="tool-search_bangumi" status="done" /></SettledFootprint> };
export const WithoutTiming: Story = { ...Collapsed, args: { ...Collapsed.args, elapsedLabel: undefined } };
