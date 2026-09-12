import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { BudgetExhaustedPreview, budgetPreviewDict } from "../../../../../.storybook/chat-errors/BudgetExhaustedPreview";
import { withChatErrors } from "../../../../../.storybook/chat-errors/decorators";
import { chatDictFor } from "../../i18n";

const meta = {
  title: "Chat/Errors/BudgetExhausted",
  component: BudgetExhaustedPreview,
  decorators: [withChatErrors],
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "The shared guest budget is temporarily exhausted, distinct from a visitor's message count. A static pause mark, quiet status and primary Animal Island sign-in action replace the warning strip. The secondary text button reveals or hides the existing BYOK explanation before any sign-in prompt. Normal login retains the current conversation; BYOK setup keeps its settings deep link. Conversation text is an authored fixture. Login uses the existing not-configured Storybook boundary; no mail, authentication, budget reset or successful continuation is simulated. This review covers the component only, with page composition and service policies unchanged." } } },
  globals: { locale: "zh" },
  args: { dict: chatDictFor("zh") },
  argTypes: { dict: { control: false } },
  render: (args) => <BudgetExhaustedPreview key={args.dict.locale} {...args} />,
  tags: ["autodocs"],
} satisfies Meta<typeof BudgetExhaustedPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DailyBudgetSpent: Story = {};
export const WithMessage: Story = { args: { withMessage: true } };
export const ByokExplainerOpen: Story = {
  play: async ({ canvasElement, globals }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: budgetPreviewDict(globals.locale).byok.d11UseOwnKey })); },
};
export const ByokExplainerClosed: Story = {
  play: async ({ canvasElement, globals }) => {
    const toggle = within(canvasElement).getByRole("button", { name: budgetPreviewDict(globals.locale).byok.d11UseOwnKey });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
  },
};
export const LoginModalOpen: Story = {
  play: async ({ canvasElement, globals }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: budgetPreviewDict(globals.locale).errorStates.d11Login })); },
};
export const ClosedWithoutLogin: Story = {
  ...WithMessage,
  play: async ({ canvasElement, globals }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: budgetPreviewDict(globals.locale).errorStates.d11Login }));
    await userEvent.keyboard("{Escape}");
  },
};
export const ByokLoginOpen: Story = {
  play: async ({ canvasElement, globals }) => {
    const byok = budgetPreviewDict(globals.locale).byok, canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: byok.d11UseOwnKey }));
    await userEvent.click(canvas.getByRole("button", { name: byok.signInToSetUp }));
  },
};
export const Narrow: Story = { ...WithMessage, parameters: { chatViewport: "component-narrow" } };
export const NarrowExplainer: Story = { ...ByokExplainerOpen, parameters: { chatViewport: "component-narrow" } };
export const Chinese: Story = { globals: { locale: "zh" } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" } };
export const JapaneseExplainer: Story = { ...NarrowExplainer, globals: { locale: "ja" } };
export const English: Story = { ...WithMessage, globals: { locale: "en" } };
export const NarrowEnglish: Story = { ...Narrow, globals: { locale: "en" } };
export const EnglishExplainer: Story = { ...NarrowExplainer, globals: { locale: "en" } };
