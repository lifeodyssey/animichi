import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { LiveLoginPreview, LoginModalPreview } from "../../../../.storybook/auth/LoginModalPreview";

const meta = {
  title: "Auth/Login Modal", component: LoginModalPreview,
  parameters: { layout: "fullscreen", docs: { description: { component: "Email login with an explicit inbox handoff. Animal Island Button/Input, a Tailwind dialog, focused errors and a preserved recipient during resend. The sent state means a link was dispatched, not that authentication or saving succeeded. Desktop starts in the email field; narrow/touch screens focus the dialog without opening a keyboard. Escape, backdrop, scroll locking and trigger focus return are retained. These are explicit presentation fixtures: sending only records a callback and enters pending, never contacts an email provider. ActualForm exercises the existing request hook behind Storybook's not-configured stub. No auth SDK, callback, save replay, page layout or backend changes." } } },
  globals: { locale: "zh" },
  args: { phase: "ready", onSend: fn(), onClose: fn(), onSendCommitted: fn() },
  render: (args) => <LoginModalPreview key={`${args.phase}:${args.email ?? ""}:${String(args.startOpen)}`} {...args} />,
} satisfies Meta<typeof LoginModalPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const FromTrigger: Story = { args: { startOpen: false } };
export const EmailEntered: Story = { play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement.ownerDocument.body).getByRole("textbox"), "fan@example.com"); } };
export const Sending: Story = { args: { phase: "sending", email: "fan@example.com" } };
export const Sent: Story = { args: { phase: "sent", email: "fan@example.com" } };
export const Resending: Story = { args: { phase: "resending", email: "fan@example.com" } };
export const SendFailed: Story = { args: { phase: "failed", email: "fan@example.com" } };
export const ResendFailed: Story = { args: { phase: "resend-failed", email: "fan@example.com" } };
export const Unavailable: Story = { args: { phase: "unavailable", email: "fan@example.com" } };
export const InvalidEmail: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement.ownerDocument.body); await userEvent.type(canvas.getByRole("textbox"), "not-an-email"); await userEvent.keyboard("{Enter}"); } };
export const LongEmail: Story = { args: { phase: "sent", email: "anime.pilgrimage.photography.club+summer-trip@example.com" } };
export const English: Story = { ...Sent, globals: { locale: "en" } };
export const Japanese: Story = { ...Sent, globals: { locale: "ja" } };
export const ActualForm: Story = { render: (args) => <LiveLoginPreview {...args} /> };
