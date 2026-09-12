import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { TripConditionsPreview } from "../../../../.storybook/chat-cards/TripConditionsPreview";
import { chatDictFor } from "../i18n";
import { emptyTravelConditions } from "../lib/trip-conditions";
import { TripConditions } from "./TripConditions";

const meta = {
  title: "Chat/Planning/TripConditions", component: TripConditions,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Isolated model-itinerary conditions UI, intended to replace the legacy four-chip DeparturePrompt when page composition is reviewed. Known facts are editable; only missing facts open as fields. Unknown facts remain empty and never block a first draft. Controlled values and callbacks only: no transport, geolocation, defaults inferred from place selection or routing service. Start time is optional. Story values are illustrative user input." } } },
  globals: { locale: "zh" },
  args: { dict: chatDictFor("zh"), value: { ...emptyTravelConditions, origin: "四谷站" }, onChange: fn(), onContinue: fn() },
  argTypes: { dict: { control: false } },
  render: (args) => <TripConditionsPreview key={JSON.stringify(args.value)} {...args} />,
} satisfies Meta<typeof TripConditions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const KnownDeparture: Story = {};
export const Undecided: Story = { args: { value: emptyTravelConditions } };
export const KnownTime: Story = { args: { value: { ...emptyTravelConditions, availableTime: "下午两点前", departureTime: "明天上午 10 点" } } };
export const AllKnown: Story = { args: { value: { origin: "四谷站", availableTime: "半天", departureTime: "明天上午 10 点" } } };
export const HalfDay: Story = { play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "半天" })); } };
export const CustomTime: Story = { play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "自己填" })); } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const LongDeparture: Story = { ...Narrow, args: { value: { ...emptyTravelConditions, origin: "東京都新宿区四谷一丁目・JR四ツ谷駅の麹町口で待ち合わせ" } } };
export const Busy: Story = { args: { busy: true, value: { origin: "四谷站", availableTime: "半天", departureTime: "" } } };
export const English: Story = { ...Undecided, ...Narrow, globals: { locale: "en" } };
export const Japanese: Story = { ...Undecided, ...Narrow, globals: { locale: "ja" } };
