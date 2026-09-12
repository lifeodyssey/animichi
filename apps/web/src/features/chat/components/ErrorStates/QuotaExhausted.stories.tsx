import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { QuotaExhaustedPreview, quotaPreviewDict, quotaPreviewDraft } from "../../../../../.storybook/chat-errors/QuotaExhaustedPreview";
import { chatDictFor } from "../../i18n";

const RESET_AT = Date.UTC(2026, 8, 13, 0, 0);

const meta = {
  title: "Chat/Errors/QuotaExhausted",
  component: QuotaExhaustedPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "A quiet, inline free-message limit with a static clock mark, explicit title, local reset date/time and one Animal Island sign-in button. Unknown or invalid reset values use timeless guidance; there is no countdown or simulated quota release. The draft remains editable and sending is withheld by the existing ChatInput quota lock. Opening or dismissing login and sending an email do not unlock it. All stories use a fixed illustrative reset instant (2026-09-13T00:00:00Z), authored conversation text and optional draft fixtures. Login uses the existing not-configured Storybook boundary, so no real email, authentication or backend request occurs. Page composition, allowance enforcement and actual automatic release are unchanged." } } },
  globals: { locale: "zh" },
  args: { dict: chatDictFor("zh"), locale: "zh", resetsAtMs: RESET_AT, onSend: fn() },
  argTypes: { dict: { control: false }, locale: { control: false } },
  render: (args) => <QuotaExhaustedPreview key={args.dict.locale} {...args} locale={args.dict.locale} />,
} satisfies Meta<typeof QuotaExhaustedPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithResetTime: Story = {};
export const ResetTimeUnavailable: Story = { args: { resetsAtMs: undefined } };
export const WithMessage: Story = { args: { withMessage: true } };
export const WithComposer: Story = {
  args: { withComposer: true },
  play: async ({ canvasElement, globals }) => { await userEvent.clear(within(canvasElement).getByRole("textbox", { name: quotaPreviewDict(globals.locale).inputPlaceholder })); },
};
export const WithDraft: Story = {
  args: { withMessage: true, withComposer: true },
  play: async ({ canvasElement, globals }) => {
    const dict = quotaPreviewDict(globals.locale);
    const input = within(canvasElement).getByRole("textbox", { name: dict.inputPlaceholder });
    await userEvent.clear(input);
    await userEvent.type(input, quotaPreviewDraft(dict));
  },
};
export const UnknownTimeWithDraft: Story = { ...WithDraft, args: { ...WithDraft.args, resetsAtMs: undefined } };
export const LoginModalOpen: Story = {
  play: async ({ canvasElement, globals }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: quotaPreviewDict(globals.locale).errorStates.d12Login })); },
};
export const ClosedWithoutLogin: Story = {
  play: async ({ canvasElement, globals }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: quotaPreviewDict(globals.locale).errorStates.d12Login }));
    await userEvent.keyboard("{Escape}");
  },
};
export const Narrow: Story = { ...WithDraft, parameters: { chatViewport: "component-narrow" } };
export const NarrowUnknownTime: Story = { ...UnknownTimeWithDraft, parameters: { chatViewport: "component-narrow" } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" } };
export const English: Story = { ...WithMessage, globals: { locale: "en" } };
export const NarrowEnglish: Story = { ...Narrow, globals: { locale: "en" } };
