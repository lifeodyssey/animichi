import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { chatDictFor } from "../i18n";
import { ColdStartPreview, coldStartPreviewDict } from "../../../../.storybook/chat-chrome/ColdStartPreview";

const meta = {
  title: "Chat/Entry/ColdStart",
  component: ColdStartPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "First-conversation invitation: explore a work's locations before deciding where and when to travel. Replaces three equally heavy feature cards with one work-based example, a quieter city example, and an optional open conversation. Every visible question is the exact outgoing message. Examples are authored prompts, not popular works, verified catalog results or recommendations. The old sample-conversation action is removed because it sent a new request instead of opening a real sample. Animal Island Button and Tailwind tokens; no mascot, new night mode or fixed-height page mockup. Selection feedback is Storybook-only and does not issue requests or simulate a reply. Existing onChip and disabled semantics remain; page composition and backend behavior are outside this review." } } },
  globals: { locale: "zh" },
  args: { dict: chatDictFor("zh") },
  argTypes: { dict: { control: false } },
  render: args => <ColdStartPreview {...args} />,
  tags: ["autodocs"],
} satisfies Meta<typeof ColdStartPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const AnimePicked: Story = {
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement), prompt = coldStartPreviewDict(globals.locale).entryAnimePrompt;
    await userEvent.click(canvas.getByRole("button", { name: prompt }));
    await expect(canvas.getByRole("status")).toHaveTextContent(prompt);
    await expect(canvas.getByRole("button", { name: prompt })).toBeDisabled();
  },
};
export const CityPicked: Story = {
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement), prompt = coldStartPreviewDict(globals.locale).entryCityPrompt;
    await userEvent.click(canvas.getByRole("button", { name: prompt }));
    await expect(canvas.getByRole("status")).toHaveTextContent(prompt);
  },
};
export const KeyboardFocus: Story = { play: async () => { await userEvent.tab(); } };
export const Disabled: Story = { args: { disabled: true } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const Japanese: Story = { globals: { locale: "ja" } };
export const English: Story = { globals: { locale: "en" } };
export const NarrowJapanese: Story = { ...Narrow, ...Japanese };
export const NarrowEnglish: Story = { ...Narrow, ...English };
