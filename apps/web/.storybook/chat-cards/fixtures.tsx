import { ChatResponseDataPart } from "@animichi/contract";
import type { ChatDataPart, TimedItinerary } from "@animichi/contract";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { ChatActionsProvider } from "../../src/features/chat/ChatActions";
import type { ChatActions } from "../../src/features/chat/ChatActions";
import type { AttachBasemap } from "../../src/features/chat/components/SearchMap";
import { SpotSelectionProvider } from "../../src/features/chat/selection/use-spot-selection";
import type { SpotSelection } from "../../src/features/chat/selection/use-spot-selection";
import type { LocatedSpot, SearchSpot } from "../../src/features/chat/lib/spot-clusters";

const euphoniumCover = new URL("./assets/euphonium.jpg", import.meta.url).href;
const euphonium2Cover = new URL("./assets/euphonium-2.jpg", import.meta.url).href;
const euphonium3Cover = new URL("./assets/euphonium-3.jpg", import.meta.url).href;
const ensembleCover = new URL("./assets/ensemble.jpg", import.meta.url).href;

export const attachFailedBasemap: AttachBasemap = ({ onStatus }) => {
  onStatus("fallback");
  return () => undefined;
};

export const ujiSpots: readonly SearchSpot[] = [
  { id: "uji-bridge", name: "宇治橋", screenshotUrl: "/images/landing/route-uji.webp", ep: 8, city: "宇治市", coord: { lat: 34.893, lng: 135.8077 } },
  { id: "keihan-uji", name: "京阪宇治駅", ep: 5, city: "宇治市", coord: { lat: 34.8945, lng: 135.8079 } },
  { id: "uji-shrine", name: "宇治神社", ep: 12, city: "宇治市", coord: { lat: 34.8918, lng: 135.8118 } },
];

export const tokyoSpots: readonly SearchSpot[] = [
  { id: "suga", name: "須賀神社 男坂", screenshotUrl: "/images/landing/suga-shrine-reality-perspective-v2.webp", ep: 1, city: "新宿区", coord: { lat: 35.685, lng: 139.72 } },
  { id: "yotsuya", name: "四ツ谷駅", ep: 1, city: "新宿区", coord: { lat: 35.686, lng: 139.73 } },
];

export const routeStations = ujiSpots as readonly LocatedSpot[];
export const offRouteSpots: readonly LocatedSpot[] = [
  { id: "byodo-in", name: "平等院", city: "宇治市", coord: { lat: 34.889, lng: 135.808 } },
];

export const ujiItinerary: TimedItinerary = {
  stops: [
    { cluster_id: "uji-bridge", name: "宇治橋", arrive: "10:00", depart: "10:20", dwell_minutes: 20, lat: 34.893, lng: 135.8077, photo_count: 2 },
    { cluster_id: "keihan-uji", name: "京阪宇治駅", arrive: "10:32", depart: "10:52", dwell_minutes: 20, lat: 34.8945, lng: 135.8079, photo_count: 9 },
    { cluster_id: "uji-shrine", name: "宇治神社", arrive: "11:00", depart: "11:20", dwell_minutes: 20, lat: 34.8918, lng: 135.8118, photo_count: 4 },
  ],
  legs: [
    { from_id: "uji-bridge", to_id: "keihan-uji", mode: "walk", duration_minutes: 12, distance_m: 740 },
    { from_id: "keihan-uji", to_id: "uji-shrine", mode: "transit", duration_minutes: 8, distance_m: 760 },
  ],
  total_minutes: 80,
  total_distance_m: 1500,
  pacing: "chill",
  start_time: "10:00",
  export_google_maps_url: ["https://www.google.com/maps"],
};

const routeRows = [...ujiSpots, ...offRouteSpots].map((spot) => ({
  id: spot.id,
  name: spot.name,
  lat: spot.coord?.lat,
  lng: spot.coord?.lng,
  city: spot.city,
  screenshot_url: spot.screenshotUrl ?? "",
  episode: spot.ep ?? -1,
}));

export function parsePart(data: unknown): ChatDataPart {
  return ChatResponseDataPart.parse(data);
}

export const fullRoutePart = parsePart({
  intent: "plan_route",
  success: true,
  status: "ok",
  message: "宇治をゆっくり歩く、3スポットの巡礼ルートです。",
  data: {
    results: { rows: routeRows },
    itinerary: {
      id: "route-uji",
      anime_title: "響け！ユーフォニアム",
      ordered_points: routeRows.slice(0, 3),
      point_count: 3,
      total_walk_minutes: 20,
      timed_itinerary: ujiItinerary,
    },
  },
});

export const untimedRoutePart = parsePart({
  intent: "plan_route",
  success: true,
  status: "ok",
  data: { itinerary: { ordered_points: routeRows.slice(0, 3), point_count: 3, total_walk_minutes: 20 } },
});

export const clarifyPart = parsePart({
  intent: "clarify",
  success: true,
  data: {
    clarification_id: 7,
    candidates: [
      { id: "115908", title: "響け！ユーフォニアム", title_cn: "吹响吧！上低音号", cover_url: euphoniumCover },
      { id: "152091", title: "響け！ユーフォニアム2", title_cn: "吹响吧！上低音号 第二季", cover_url: euphonium2Cover },
      { id: "283643", title: "響け！ユーフォニアム3", title_cn: "吹响吧！上低音号 第三季", cover_url: euphonium3Cover },
      { id: "386195", title: "特別編 響け！ユーフォニアム～アンサンブルコンテスト～", title_cn: "吹响吧！上低音号 合奏比赛篇", cover_url: ensembleCover },
    ],
  },
});

export const searchPart = {
  intent: "search_bangumi",
  success: true,
  status: "ok",
  message: "まずは宇治エリアの候補を見つけました。",
  data: { results: { title: "響け！ユーフォニアム", rows: routeRows.slice(0, 3) } },
};

const defaultActions: ChatActions = {
  send: () => undefined,
  regenerate: () => undefined,
  sendWithOrigin: () => undefined,
};

export function ChatStoryProviders({ children }: Readonly<{ children: ReactNode }>) {
  return <ChatActionsProvider actions={defaultActions}>{children}</ChatActionsProvider>;
}

function toggled(previous: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(previous);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function SelectionStoryProvider({ children, initial = [] }: Readonly<{ children: ReactNode; initial?: readonly string[] }>) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initial));
  const selection = useMemo<SpotSelection>(() => ({ selected, toggle: (id) => { setSelected((previous) => toggled(previous, id)); } }), [selected]);
  return <SpotSelectionProvider selection={selection}>{children}</SpotSelectionProvider>;
}
