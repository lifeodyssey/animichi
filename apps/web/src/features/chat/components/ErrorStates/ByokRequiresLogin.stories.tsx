import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ByokRequiresLoginPreview, byokLoginPreviewDict } from "../../../../../.storybook/chat-errors/ByokRequiresLoginPreview";
import { chatDictFor } from "../../i18n";

const meta = {
  title: "Chat/Errors/ByokRequiresLogin",
  component: ByokRequiresLoginPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "D13: a personal API key requires sign-in. One continuous prompt replaces the stacked warning strip and explanation card. The account requirement is announced; provider billing and session-scoped key handling remain visible before the single Animal Island sign-in button. Shared setup details preserve the approved ByokUpsell layout and /settings#api-key callback. Closing login returns focus and retains the prompt. Message context is an authored fixture; login uses the existing not-configured Storybook boundary. No real email, authentication, credential changes or automatic resend is simulated. This is a component review; Chat page composition is unchanged." } } },
  globals: { locale: "zh" },
  args: { dict: chatDictFor("zh") },
  argTypes: { dict: { control: false } },
  render: (args) => <ByokRequiresLoginPreview {...args} />,
  tags: ["autodocs"],
} satisfies Meta<typeof ByokRequiresLoginPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const WithMessage: Story = { args: { withMessage: true } };
export const LoginModalOpen: Story = {
  play: async ({ canvasElement, globals }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: byokLoginPreviewDict(globals.locale).byok.signInToSetUp })); },
};
export const ClosedWithoutLogin: Story = {
  ...WithMessage,
  play: async ({ canvasElement, globals }) => {
    const button = within(canvasElement).getByRole("button", { name: byokLoginPreviewDict(globals.locale).byok.signInToSetUp });
    await userEvent.click(button);
    await userEvent.keyboard("{Escape}");
    await expect(button).toHaveFocus();
  },
};
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const NarrowWithMessage: Story = { ...Narrow, ...WithMessage };
export const NarrowLogin: Story = { ...LoginModalOpen, parameters: { chatViewport: "component-narrow" } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" } };
export const English: Story = { globals: { locale: "en" } };
export const NarrowEnglish: Story = { ...Narrow, globals: { locale: "en" } };
