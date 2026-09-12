import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { chatDictFor } from "../i18n";
import { ChatAppBarPreview, appBarPreviewDict } from "../../../../.storybook/chat-chrome/ChatAppBarPreview";
import { ChatAppBar } from "./ChatAppBar";

const meta = {
  title: "Chat/Chrome/ChatAppBar", component: ChatAppBar,
  parameters: { chatViewport: "component-appbar", layout: "centered", docs: { description: { component: "Mobile controls only: a plain localized wordmark, login, new conversation and settings. Animal Island Button and link styles provide 44px targets. No mascot, outlined lettering, fabricated avatar or account data. The existing full-document /chat reset and session-carrying settings link remain. Login is only offered to anonymous visitors; modal cancellation restores focus without changing auth state. The preview isolates the mobile bar even on a desktop Storybook canvas; DesktopHidden keeps the real breakpoint. Authentication is a supplied fixture and the existing login stub never sends email. No page layout or backend changes." } } },
  globals: { locale: "zh" }, args: { dict: chatDictFor("zh"), status: "anonymous" },
  argTypes: { dict: { control: false } }, render: args => <ChatAppBarPreview {...args} />,
} satisfies Meta<typeof ChatAppBar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Anonymous: Story = {};
export const Pending: Story = { args: { status: "pending" } };
export const Authenticated: Story = { args: { status: "authenticated" } };
export const Japanese: Story = { globals: { locale: "ja" } };
export const English: Story = { globals: { locale: "en" } };
export const LoginOpen: Story = { play: async ({ canvasElement, globals }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: appBarPreviewDict(globals.locale).appbar.login })); } };
export const LoginCancelled: Story = { play: async ({ canvasElement, globals }) => {
  const button = within(canvasElement).getByRole("button", { name: appBarPreviewDict(globals.locale).appbar.login });
  await userEvent.click(button);
  await userEvent.keyboard("{Escape}");
  await expect(within(canvasElement.ownerDocument.body).queryByRole("dialog")).not.toBeInTheDocument();
  await expect(button).toHaveFocus();
} };
export const KeyboardFocus: Story = { play: async ({ canvasElement, globals }) => { const link = within(canvasElement).getByRole("link", { name: appBarPreviewDict(globals.locale).newJourney }); link.focus(); await expect(link).toHaveFocus(); } };
export const DesktopHidden: Story = { render: args => <ChatAppBar {...args} /> };
