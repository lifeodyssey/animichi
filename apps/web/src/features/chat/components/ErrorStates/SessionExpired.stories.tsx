import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { SessionExpiredPreview } from "../../../../../.storybook/chat-errors/SessionExpiredPreview";
import { chatDictFor } from "../../i18n";

const meta = {
  title: "Chat/Errors/SessionExpired",
  component: SessionExpiredPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "An in-place sign-in expiry notice using Animal Island 1.10.0 Buttons and Tailwind. Sign in again is the primary action; a quieter, contextual action reads the latest conversation after sign-in. Opening or dismissing the login dialog, or sending an email, does not authenticate the visitor or trigger recovery. Only the supplied recovering flag announces pending history and locks both controls while preserving focus. All stories are frontend fixtures: resume records its callback and shows a pending read, with no backend requests or fabricated completion. Login uses the existing Storybook not-configured boundary. Conversation text is authored; page composition, auth and history recovery logic are unchanged." } } },
  globals: { locale: "zh" },
  args: { dict: chatDictFor("zh"), onResume: fn() },
  argTypes: { dict: { control: false } },
  render: (args) => <SessionExpiredPreview key={`${args.dict.locale}:${String(args.recovering)}`} {...args} />,
} satisfies Meta<typeof SessionExpiredPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToResume: Story = {};
export const LoginModalOpen: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: args.dict.errorStates.d8Login }));
  },
};
export const Recovering: Story = { args: { recovering: true } };
export const WithMessage: Story = { args: { withMessage: true } };
export const RecoveringWithMessage: Story = { args: { withMessage: true, recovering: true } };
export const ResumeRequested: Story = {
  ...WithMessage,
  play: async ({ canvasElement, args }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: args.dict.errorStates.d8Resume })); },
};
export const ClosedWithoutLogin: Story = {
  ...WithMessage,
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: args.dict.errorStates.d8Login }));
    await userEvent.keyboard("{Escape}");
  },
};
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" }, args: { withMessage: true } };
export const NarrowRecovering: Story = { ...Narrow, args: { withMessage: true, recovering: true } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" } };
export const NarrowEnglish: Story = {
  ...Narrow, globals: { locale: "en" },
};
