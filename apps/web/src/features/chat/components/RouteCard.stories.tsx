import type { Meta, StoryObj } from "@storybook/react-vite";
import { attachFailedBasemap, fullRoutePart, untimedRoutePart, parsePart, ujiItinerary } from "../../../../.storybook/chat-cards/fixtures";
import { attachBasemap } from "../../bubble-map/bubble-map-controller";
import { chatDictFor } from "../i18n";
import { RouteCard } from "./RouteCard";
import { ResultCardSurface } from "./ResultCardSurface";

const meta = {
  title: "Chat/Cards/RouteCard",
  component: RouteCard,
  decorators: [(Story) => <ResultCardSurface intent="plan_route"><Story /></ResultCardSurface>],
  args: { part: fullRoutePart, dict: chatDictFor("ja"), attach: attachBasemap },
  parameters: { layout: "padded" },
} satisfies Meta<typeof RouteCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CompleteRoute: Story = {};
/** Real MapLibre over the local .cache/tiles copy (see .storybook/main.ts) — the map-skin design story. */
export const LiveBasemap: Story = { args: { attach: attachBasemap } };
export const NarrowCompleteRoute: Story = { parameters: { chatViewport: "narrow" }, globals: { viewport: { value: "375-812", isRotated: false } } };
export const BasemapUnavailable: Story = { args: { attach: attachFailedBasemap } };
export const BeforeTimetableArrives: Story = { args: { part: untimedRoutePart } };
export const English: Story = { args: { dict: chatDictFor("en") }, globals: { locale: "en" } };
export const Chinese: Story = { args: { dict: chatDictFor("zh") }, globals: { locale: "zh" } };

export const LongNames: Story = {
  args: { part: parsePart({ intent: "plan_route", data: { ...fullRoutePart.data, itinerary: {
    anime_title: "響け！ユーフォニアム — 宇治をめぐる聖地巡礼の一日",
    point_count: 3, total_walk_minutes: 20,
    timed_itinerary: { ...ujiItinerary, stops: ujiItinerary.stops.map((stop) => ({ ...stop, name: `${stop.name}・テレビシリーズ最終章の名場面` })) },
  } } }) },
};

export const WithoutCoordinates: Story = {
  args: { part: parsePart({ intent: "plan_route", data: { itinerary: {
    anime_title: "響け！ユーフォニアム", point_count: 2,
    ordered_points: [{ id: "bridge", name: "宇治橋" }, { id: "station", name: "京阪宇治駅" }],
  } } }) },
};

export const TimedStopsWithoutResults: Story = {
  args: { part: parsePart({ intent: "plan_route", data: { itinerary: {
    anime_title: "響け！ユーフォニアム", point_count: 3, timed_itinerary: ujiItinerary,
  } } }) },
};
