import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { ItineraryDraftPreview } from "../../../../.storybook/chat-cards/ItineraryDraftPreview";
import { itineraryDraftFixture } from "../../../../.storybook/chat-cards/itinerary-draft-fixtures";
import { chatDictFor } from "../i18n";
import { emptyTravelConditions } from "../lib/trip-conditions";
import { ItineraryDraft } from "./ItineraryDraft";
import { manyItineraryFixture } from "../../../../.storybook/chat-cards/many-itinerary-fixtures";

const draft = itineraryDraftFixture("zh");
const first = draft.stops[0];
const meta = {
  title: "Chat/Planning/ItineraryDraft", component: ItineraryDraft,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Isolated model-itinerary document: user facts, ordered places, preserved viewpoint images, optional estimated stay ranges and explicit assumptions. Existing Tokyo locations/images are from separate works; the copy, grouping and time ranges are illustrative, not live model output or verified routing. Save/adjust emit the visible draft id only. Map composition, model calls, persistence and page navigation remain unwired." } } },
  globals: { locale: "zh" }, args: { draft, dict: chatDictFor("zh"), onSave: fn(), onAdjust: fn() },
  argTypes: { dict: { control: false } }, render: (args) => <ItineraryDraftPreview {...args} />,
} satisfies Meta<typeof ItineraryDraft>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const Viewpoints: Story = { play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "地点详情: 須賀神社 男坂" })); } };
export const UndecidedConditions: Story = { args: { draft: { ...draft, conditions: emptyTravelConditions, assumptions: ["起点和可用时间还没定，这版先给出游览顺序。"], stops: draft.stops.map((stop) => ({ ...stop, stayEstimate: undefined })) } } };
export const OnePlace: Story = { args: { draft: { ...draft, stops: draft.stops.slice(0, 1), introduction: "这次先留时间给须贺神社和你选的画面。" } } };
export const NoImages: Story = { args: { draft: { ...draft, stops: draft.stops.map((stop) => ({ ...stop, place: { ...stop.place, viewpoints: stop.place.viewpoints.map((viewpoint) => ({ ...viewpoint, frames: [] })) } })) } } };
export const FailedImage: Story = { args: { draft: { ...draft, stops: draft.stops.map((stop) => ({ ...stop, place: { ...stop.place, viewpoints: [{ id: "failed", frames: [{ id: "failed", url: "/unavailable-draft-scene.webp" }] }] } })) } } };
export const Updating: Story = { args: { revision: { state: "updating" } } };
export const UpdateFailed: Story = { args: { revision: { state: "failed", onRetry: fn() } } };
export const Empty: Story = { args: { draft: { ...draft, introduction: undefined, stops: [] } } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const LongName: Story = { ...Narrow, args: { draft: { ...draft, stops: [{ ...first, place: { ...first.place, name: "東京都新宿区須賀町・須賀神社の男坂（長い名称の表示例）" } }] } } };
export const English: Story = { ...Narrow, globals: { locale: "en" }, args: { draft: itineraryDraftFixture("en") } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" }, args: { draft: itineraryDraftFixture("ja") } };
export const ManyPlaces: Story = { args: { draft: manyItineraryFixture("zh") } };
