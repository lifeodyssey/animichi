import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { TurnstilePreview, turnstilePreviewDict } from "../../../../.storybook/chat-errors/TurnstilePreview";
import { chatDictFor } from "../i18n";

const meta = {
  title: "Chat/Entry/TurnstileGate",
  component: TurnstilePreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Visitor verification in a quiet Animal Island frame. RealWidget loads Cloudflare's actual SDK with its official interactive test key. The vendor owns its branding, challenge and success mark. The production appearance stays interaction-only; the embed switches from flexible (minimum 300px wide) to compact (150 by 140px) according to container width. Language follows the app. SDK events distinguish checking, required interaction, awaiting server confirmation and failure. A widget token never grants access on its own. Real-widget stories need network access and do not call the verification endpoint or store test tokens. Other stories are deterministic app-state fixtures without a simulated vendor widget. Chat page admission policy is unchanged." } } },
  globals: { locale: "zh" },
  args: { dict: chatDictFor("zh") },
  argTypes: { dict: { control: false }, testCase: { control: false } },
  render: args => <TurnstilePreview {...args} />,
  tags: ["autodocs"],
} satisfies Meta<typeof TurnstilePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RealWidget: Story = { args: { testCase: "interactive" } };
export const RealWidgetNarrow: Story = { ...RealWidget, parameters: { chatViewport: "component-narrow" } };
export const RealWidgetJapanese: Story = { ...RealWidget, globals: { locale: "ja" } };
export const RealWidgetEnglish: Story = { ...RealWidget, globals: { locale: "en" } };
export const RealWidgetPass: Story = { args: { testCase: "pass" } };
export const RealWidgetFailure: Story = { args: { testCase: "fail" } };
export const ArmedQuietly: Story = {};
export const AwaitingConfirmation: Story = { args: { state: "verifying" } };
export const ChallengeFailed: Story = { args: { state: "failed" } };
export const RetryPending: Story = {
  ...ChallengeFailed,
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement), copy = turnstilePreviewDict(globals.locale).turnstile;
    await userEvent.click(canvas.getByRole("button", { name: copy.retry }));
    await expect(canvas.getByRole("status")).toHaveTextContent(copy.checkingTitle);
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};
export const NarrowFailure: Story = { ...ChallengeFailed, parameters: { chatViewport: "component-narrow" } };
export const NarrowEnglish: Story = { ...RealWidgetNarrow, globals: { locale: "en" } };
