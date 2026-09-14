import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SaveSavedRouteRequest } from "../../../api/hooks/use-saved-route";
import { itineraryView } from "../lib/itinerary";
import { chatDictFor } from "../i18n";
import { ujiItinerary } from "../../../../.storybook/chat-cards/fixtures";
import { TimedItinerary } from "./TimedItinerary";

const unavailableSave: SaveSavedRouteRequest = () =>
  Promise.reject(Object.assign(new Error("Storybook simulated outage"), { status: 503 }));

const save = { pointIds: ["uji-bridge", "keihan-uji", "uji-shrine"], title: "宇治巡礼・3スポット" };
const view = itineraryView(ujiItinerary);

const meta = {
  title: "Chat/Cards/TimedItinerary",
  component: TimedItinerary,
  args: { view, dict: chatDictFor("ja"), save, saveDeps: { authStatus: "anonymous", request: unavailableSave } },
} satisfies Meta<typeof TimedItinerary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SignedInSaveFailure: Story = { args: { saveDeps: { authStatus: "authenticated", request: unavailableSave } } };
export const WithoutExportOrPacing: Story = { args: { view: { ...view, mapsUrl: undefined, pacing: undefined }, save: undefined } };
export const LongStationNames: Story = {
  args: { view: { ...view, stations: view.stations.map((station) => ({ ...station, name: `${station.name}・テレビシリーズ最終章の重要な場面` })) } },
};
export const English: Story = { args: { dict: chatDictFor("en") }, globals: { locale: "en" } };
export const Chinese: Story = { args: { dict: chatDictFor("zh") }, globals: { locale: "zh" } };
