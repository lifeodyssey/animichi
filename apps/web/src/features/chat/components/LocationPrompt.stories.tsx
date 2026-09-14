import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { LocationPromptPreview, LOCATION_PREVIEW_WIDTH } from "../../../../.storybook/chat-chrome/LocationPromptPreview";
import { chatDictFor } from "../i18n";
import { isLocale } from "../../../i18n/locales";
import { resetGeoPlatform } from "../../../platform/geo";
import { LocationPrompt } from "./LocationPrompt";

function storyDict(globals: Record<string, unknown>) {
  return chatDictFor(typeof globals.locale === "string" && isLocale(globals.locale) ? globals.locale : "zh");
}

const meta = {
  title: "Chat/Entry/LocationPrompt", component: LocationPromptPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Compact current-location action and manual place form using Animal Island Button/Input. Manual entry is available before permission, while waiting and after a failure. Submission preserves the chosen place in a quiet confirmation; it does not imply search results have arrived. No raw coordinates, inferred station or map preview. Normal stories use explicit phases: the location action enters pending, manual submission only records the callback. DeniedAfterClick exercises the real component with Storybook's deterministic denied platform stub. No browser GPS is requested, and no Chat page or platform API is changed." } } },
  globals: { locale: "zh" }, args: { dict: chatDictFor("zh"), state: { phase: "idle" }, onLocate: fn(), onManual: fn() },
  argTypes: { dict: { control: false }, state: { control: false } },
  render: (args) => <LocationPromptPreview key={`${args.dict.locale}:${JSON.stringify(args.state)}`} {...args} />,
} satisfies Meta<typeof LocationPromptPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PermissionRequest: Story = {};
export const PlaceEntered: Story = { play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByRole("textbox"), "宇治站"); } };
export const Pending: Story = { args: { state: { phase: "pending" } } };
export const Unavailable: Story = { args: { state: { phase: "denied" } } };
export const CurrentLocationSent: Story = { args: { state: { phase: "sent" } } };
export const ManualPlaceSent: Story = { args: { state: { phase: "sent", place: "宇治站" } } };
export const Disabled: Story = { args: { disabled: true } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const NarrowUnavailable: Story = { ...Unavailable, ...Narrow };
export const LongPlace: Story = { ...Narrow, args: { state: { phase: "sent", place: "東京都新宿区四谷一丁目・JR四ツ谷駅の麹町口で待ち合わせ" } } };
export const English: Story = { ...NarrowUnavailable, globals: { locale: "en" } };
export const Japanese: Story = { ...NarrowUnavailable, globals: { locale: "ja" } };
export const DeniedAfterClick: Story = {
  beforeEach: () => { resetGeoPlatform(); return resetGeoPlatform; },
  render: ({ dict, onManual }) => <div className={LOCATION_PREVIEW_WIDTH}><LocationPrompt dict={dict} onLocated={fn()} onManual={onManual} /></div>,
  play: async ({ canvasElement, globals }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: storyDict(globals).location.allow })); },
};
