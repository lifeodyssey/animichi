import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { EnvelopeFallbackPreview, FALLBACK_PREVIEW_WIDTH } from "../../../../../.storybook/chat-errors/EnvelopeFallbackPreview";
import { chatDictFor } from "../../i18n";
import { NoSpotsContent } from "./EnvelopeFallback";

const meta = {
  title: "Chat/Errors/EnvelopeFallback",
  component: EnvelopeFallbackPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "A quiet recovery entry for settled replies. Unrecognized titles and empty searches accept user-supplied clues instead of unrelated example chips. Missing coordinates keep existing place cards visible; they are not an empty catalog. Timeout and generic failure retry the existing message. Animal Island Button/Input with Tailwind; no mascot, outer card or invented catalog coverage. Stories use explicit states. Sending or retrying records the callback and enters a disabled waiting boundary, without a network request or simulated successful result. No Chat page layout changes." } } },
  globals: { locale: "zh" },
  args: { state: "D1", dict: chatDictFor("zh"), onSend: fn(), onRetry: fn() },
  argTypes: { dict: { control: false } },
  render: (args) => <EnvelopeFallbackPreview key={`${args.dict.locale}:${args.state}:${String(args.disabled)}`} {...args} />,
} satisfies Meta<typeof EnvelopeFallbackPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RecognitionFailure: Story = {};
export const NoSpots: Story = { args: { state: "D2" } };
export const TimedOutApology: Story = { args: { state: "D5" } };
export const GenericApology: Story = { args: { state: "D6" } };
export const ClueEntered: Story = { play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByRole("textbox"), "两个高中生交换了身体"); } };
export const ClueSent: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.type(canvas.getByRole("textbox"), "两个高中生交换了身体"); await userEvent.click(canvas.getByRole("button")); } };
export const RetryRequested: Story = { ...TimedOutApology, play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button")); } };
export const Disabled: Story = { args: { disabled: true } };
export const DisabledRetry: Story = { args: { state: "D6", disabled: true } };
export const MissingCoordinates: Story = { render: ({ dict }) => <div className={FALLBACK_PREVIEW_WIDTH}><NoSpotsContent dict={dict} hasUnlocatedSpots /></div> };
export const NarrowChinese: Story = {
  parameters: { chatViewport: "component-narrow" },
};
export const NarrowNoSpots: Story = { ...NarrowChinese, ...NoSpots };
export const English: Story = { ...NarrowChinese, globals: { locale: "en" } };
export const Japanese: Story = { ...NarrowChinese, globals: { locale: "ja" } };
export const LongClue: Story = { ...NarrowChinese, play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByRole("textbox"), "这部动画里有一群高中生在宇治练习吹奏乐，我想找他们经过的桥和车站"); } };
