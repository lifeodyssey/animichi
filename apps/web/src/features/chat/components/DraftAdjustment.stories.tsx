import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { DraftAdjustmentPreview } from "../../../../.storybook/chat-cards/DraftAdjustmentPreview";
import { draftPlaceCandidates, itineraryDraftFixture } from "../../../../.storybook/chat-cards/itinerary-draft-fixtures";
import { chatDictFor } from "../i18n";
import { emptyTravelConditions } from "../lib/trip-conditions";
import { manyItineraryFixture } from "../../../../.storybook/chat-cards/many-itinerary-fixtures";

const draft = itineraryDraftFixture("zh");
const meta = {
  title: "Chat/Planning/DraftAdjustment", component: DraftAdjustmentPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "The complete itinerary stays visible while editing. Remove places with undo, toggle their viewpoints, and add from an inline gallery of supplied candidates. The input sits below the itinerary; selection-only updates are valid. Changed selections clear stale model prose until a real new draft arrives. View original restores the unchanged source; returning to adjustment keeps local edits. Submit emits source draft id, exact proposed places/viewpoints and text, then waits without fabricating model output. Tokyo fixture data comes from separate works; Yotsuya has no supplied image. Full catalog/map browsing, Chat pages and persistence remain unwired." } } },
  globals: { locale: "zh" }, args: { draft, places: draft.stops.map((stop) => stop.place), candidates: draftPlaceCandidates, dict: chatDictFor("zh"), value: "", status: "ready", onChange: fn(), onPlacesChange: fn(), onSubmit: fn(), onBack: fn(), onSave: fn() },
  argTypes: { dict: { control: false } }, render: (args) => <DraftAdjustmentPreview key={`${args.dict.locale}:${args.draft.id}:${args.status ?? "ready"}`} {...args} />,
} satisfies Meta<typeof DraftAdjustmentPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const FromDraft: Story = { args: { startEditing: false } };
export const Viewpoints: Story = { play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "地点详情: 須賀神社 男坂" })); } };
export const AddPlaces: Story = { play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "添加地点" })); } };
export const ChangedPlaces: Story = { args: { places: draft.stops.slice(0, 1).map((stop) => stop.place) } };
export const EmptySelection: Story = { args: { places: [] } };
export const WithRequest: Story = { args: { value: "下午两点从新宿站出发，想多留一点时间拍照。" } };
export const Updating: Story = { ...WithRequest, args: { ...WithRequest.args, status: "updating" } };
export const Failed: Story = { ...WithRequest, args: { ...WithRequest.args, status: "failed" } };
export const UnknownConditions: Story = { args: { draft: { ...draft, conditions: emptyTravelConditions } } };
export const OnePlace: Story = { args: { draft: { ...draft, introduction: undefined, stops: draft.stops.slice(0, 1) }, places: draft.stops.slice(0, 1).map((stop) => stop.place) } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const LongRequest: Story = { ...Narrow, args: { draft: { ...draft, title: "东京周末巡礼：须贺神社与参宫桥，想慢慢逛的一天", conditions: { ...draft.conditions, origin: "新宿站东南口附近的住宿处（长名称展示样例）" } }, value: "下午两点再出发。\n想在须贺神社多拍几张照片，每个已经选好的取景位置都想看看。\n如果时间不够，先告诉我可能需要怎么取舍。\n暂时不增加别的地点，步调尽量轻松一点。" } };
export const English: Story = { ...Narrow, globals: { locale: "en" }, args: { draft: itineraryDraftFixture("en") } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" }, args: { draft: itineraryDraftFixture("ja") } };

const many = manyItineraryFixture("zh");
export const ManyPlaces: Story = { args: { draft: many, places: many.stops.map((stop) => stop.place), candidates: [] }, parameters: { docs: { description: { story: "30 synthetic ids repeat the existing Tokyo image samples with example labels. This tests list capacity, search, expansion, exact selection edits and pinned actions; it does not imply 30 real catalog places or a feasible itinerary." } } } };
export const ManyPlacesNarrow: Story = { ...ManyPlaces, parameters: { ...ManyPlaces.parameters, chatViewport: "component-narrow" } };
export const FindPlace: Story = { ...ManyPlaces, play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByRole("textbox", { name: "查找草案里的地点" }), "18"); } };
export const NoMatches: Story = { ...ManyPlaces, play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByRole("textbox", { name: "查找草案里的地点" }), "没有的地点"); } };
export const ManyPlacesEnglish: Story = { ...ManyPlacesNarrow, globals: { locale: "en" }, args: { draft: manyItineraryFixture("en"), places: manyItineraryFixture("en").stops.map((stop) => stop.place), candidates: [] } };
export const ManyPlacesJapanese: Story = { ...ManyPlacesNarrow, globals: { locale: "ja" }, args: { draft: manyItineraryFixture("ja"), places: manyItineraryFixture("ja").stops.map((stop) => stop.place), candidates: [] } };
