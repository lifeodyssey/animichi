import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ByokRejectedPreview, byokRejectedPreviewDict } from "../../../../../.storybook/chat-errors/ByokRejectedPreview";
import { chatDictFor } from "../../i18n";

const meta = {
  title: "Chat/Errors/ByokRejected",
  component: ByokRejectedPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "D14: the model provider did not accept the supplied key. A quiet inline alert explains the failure and points to key settings, using Animal Island's native-link class layer and Tailwind semantic tokens. The /settings#api-key link retains the current session; it does not resend, switch models or mutate credentials. The previous message and session are authored fixtures. Storybook retains the real link destination without demonstrating key repair, a provider request or a successful settings-page round trip. Chat page composition and backend behavior are unchanged." } } },
  globals: { locale: "zh" },
  args: { dict: chatDictFor("zh"), sessionId: "storybook-byok-chat" },
  argTypes: { dict: { control: false } },
  render: (args) => <ByokRejectedPreview {...args} />,
  tags: ["autodocs"],
} satisfies Meta<typeof ByokRejectedPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const WithMessage: Story = { args: { withMessage: true } };
export const WithoutSession: Story = { args: { sessionId: undefined } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const NarrowWithMessage: Story = { ...Narrow, args: { withMessage: true } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" } };
export const English: Story = { globals: { locale: "en" } };
export const NarrowEnglish: Story = { ...Narrow, globals: { locale: "en" } };
export const KeyboardFocused: Story = {
  play: async ({ canvasElement, globals }) => {
    const link = within(canvasElement).getByRole("link", { name: byokRejectedPreviewDict(globals.locale).byok.openSettings });
    link.focus();
    await expect(link).toHaveFocus();
  },
};
