import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { StreamInterruptionPreview } from "../../../../../.storybook/chat-errors/StreamInterruptionPreview";
import { chatDictFor } from "../../i18n";

const meta = {
  title: "Chat/Errors/StreamInterruption",
  component: StreamInterruptionPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Quiet feedback at the end of an interrupted reply, with an Animal Island Button and Tailwind. The seven existing interruption states keep their own action; a supplied recovering flag explicitly means reading the latest conversation. The existing button stays mounted and disabled while loading. Unknown error codes remain verbatim in expandable details. No outer alert strip, mascot, speculative progress or automatic retry. All stories are frontend fixtures: retry records its callback and demonstrates only the read-latest pending branch, never a successful response. Message context is authored. Chat layout, classification, resend and history recovery logic are unchanged." } } },
  globals: { locale: "zh" },
  args: { state: "D4", dict: chatDictFor("zh"), onRetry: fn() },
  argTypes: { dict: { control: false } },
  render: (args) => <StreamInterruptionPreview key={`${args.dict.locale}:${args.state}:${String(args.recovering)}:${args.errorCode ?? ""}`} {...args} />,
} satisfies Meta<typeof StreamInterruptionPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {};
export const TimedOut: Story = { args: { state: "D5" } };
export const RateLimited: Story = { args: { state: "D10" } };
export const TurnInFlight: Story = { args: { state: "D15" } };
export const StaleSession: Story = { args: { state: "D16" } };
export const PreviousTurnFailed: Story = { args: { state: "D17" } };
export const HonestGeneric: Story = { args: { state: "D18", errorCode: "unexpected_upstream_status" } };
export const Recovering: Story = { args: { state: "D4", recovering: true } };
export const WithMessage: Story = { args: { withMessage: true } };
export const RecoveringWithMessage: Story = { args: { withMessage: true, recovering: true } };
export const RetryRequested: Story = { ...WithMessage, play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button")); } };
export const ErrorDetailsOpen: Story = { ...HonestGeneric, play: async ({ canvasElement, args }) => { await userEvent.click(within(canvasElement).getByText(args.dict.errorStates.interruptionDetails)); } };
export const MissingErrorCode: Story = { args: { state: "D18" } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" }, args: { withMessage: true } };
export const NarrowRecovering: Story = { ...Narrow, args: { withMessage: true, recovering: true } };
export const LongErrorCode: Story = { ...ErrorDetailsOpen, parameters: { chatViewport: "component-narrow" }, args: { state: "D18", errorCode: "gateway_contract_mismatch_unexpected_upstream_response_schema_validation_failed" } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" }, args: { withMessage: true, state: "D16" } };
export const NarrowEnglish: Story = {
  ...Narrow, globals: { locale: "en" }, args: { withMessage: true, state: "D16" },
};
