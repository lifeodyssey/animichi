import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { ByokUpsellPreview, byokPreviewDict } from "../../../../.storybook/chat-errors/ByokUpsellPreview";
import { chatDictFor } from "../i18n";

const meta = {
  title: "Chat/Account/ByokUpsell",
  component: ByokUpsellPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "A compact explanation of using a personal model-provider API key. Provider billing and session-scoped key handling are explicit; no unlimited usage, plan price or automatic setup is promised. Animal Island Button and Tailwind replace the legacy outlined card and bullet block. Sign-in keeps the existing /settings#api-key callback. Closing login preserves the explanation and returns focus; email delivery is not authentication or key setup. The budget context is an explicit component fixture. Storybook uses the existing not-configured login boundary, with no real email, credentials, provider requests or budget release. Settings, auth, credential storage and Chat page composition are unchanged." } } },
  globals: { locale: "zh" },
  args: { dict: chatDictFor("zh") },
  argTypes: { dict: { control: false } },
  render: (args) => <ByokUpsellPreview key={args.dict.locale} {...args} />,
  tags: ["autodocs"],
} satisfies Meta<typeof ByokUpsellPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const InBudgetNotice: Story = {
  args: { inBudget: true },
  play: async ({ canvasElement, globals }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: byokPreviewDict(globals.locale).byok.d11UseOwnKey })); },
};
export const LoginModalOpen: Story = {
  play: async ({ canvasElement, globals }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: byokPreviewDict(globals.locale).byok.signInToSetUp })); },
};
export const ClosedWithoutLogin: Story = {
  play: async ({ canvasElement, globals }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: byokPreviewDict(globals.locale).byok.signInToSetUp }));
    await userEvent.keyboard("{Escape}");
  },
};
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const NarrowInBudget: Story = { ...InBudgetNotice, parameters: { chatViewport: "component-narrow" } };
export const Chinese: Story = { globals: { locale: "zh" } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" } };
export const English: Story = { globals: { locale: "en" } };
export const NarrowEnglish: Story = { ...Narrow, globals: { locale: "en" } };
export const JapaneseInBudget: Story = { ...NarrowInBudget, globals: { locale: "ja" } };
export const EnglishInBudget: Story = { ...NarrowInBudget, globals: { locale: "en" } };
