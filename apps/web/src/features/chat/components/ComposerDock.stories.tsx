import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { chatDictFor } from "../i18n";
import { withChatLocale } from "../../../../.storybook/chat-chrome/story-helpers";
import { ComposerDock } from "./ComposerDock";

const meta = { title: "Chat/Composer/ComposerDock", component: ComposerDock, decorators: [withChatLocale] } satisfies Meta<typeof ComposerDock>;
export default meta;
type Story = StoryObj<typeof meta>;
const base = { dict: chatDictFor("ja"), baseUrl: "/storybook", photo: { locale: "ja" as const }, gate: { locked: false, busy: false, failed: false }, quotaLocked: false, onSend: fn() };
export const Ready: Story = { args: base };
export const Busy: Story = { args: { ...base, gate: { ...base.gate, busy: true } } };
export const FailedTurn: Story = { args: { ...base, gate: { ...base.gate, failed: true } } };
export const QuotaLocked: Story = { args: { ...base, quotaLocked: true } };
export const Unavailable: Story = { args: { ...base, gate: { ...base.gate, locked: true } } };
export const Narrow: Story = { args: base, parameters: { chatViewport: "narrow" }, globals: { viewport: { value: "375-812", isRotated: false } } };
