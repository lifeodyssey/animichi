import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { withChatErrors } from "../../../../../.storybook/chat-errors/decorators";
import { chatDictFor } from "../../i18n";
import { TurnFailure } from "./TurnFailure";

const callbacks = { onRetry: fn(), onExpiredResume: fn(), recovering: false };

const meta = {
  title: "Chat/Errors/TurnFailure",
  component: TurnFailure,
  decorators: [withChatErrors],
  args: { dict: chatDictFor("ja"), locale: "ja", view: { state: "D4", ...callbacks } },
  tags: ["autodocs"],
} satisfies Meta<typeof TurnFailure>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoFailure: Story = { args: { view: undefined } };
export const StreamDisconnected: Story = {};
export const SessionExpired: Story = { args: { view: { state: "D8", ...callbacks } } };
export const BudgetExhausted: Story = { args: { view: { state: "D11", ...callbacks } } };
export const QuotaExhausted: Story = {
  args: { view: { state: "D12", quotaResetsAtMs: Date.UTC(2026, 8, 9, 15), ...callbacks } },
};
export const ByokRequiresLogin: Story = { args: { view: { state: "D13", ...callbacks } } };
export const ByokRejected: Story = { args: { view: { state: "D14", ...callbacks } } };
export const TurnInFlight: Story = { args: { view: { state: "D15", ...callbacks } } };
export const StaleSession: Story = { args: { view: { state: "D16", ...callbacks } } };
export const PreviousTurnFailed: Story = { args: { view: { state: "D17", ...callbacks } } };
export const GenericFailure: Story = {
  args: { view: { state: "D18", errorCode: "unexpected_response", ...callbacks } },
};
export const Recovering: Story = {
  args: { view: { state: "D16", ...callbacks, recovering: true } },
};
