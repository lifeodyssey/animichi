import type { Locale } from "../../src/i18n/locales";
import type { HistoryReplayEntry } from "../../src/features/chat/lib/history-replay";
import { itineraryDraftFixture } from "../chat-cards/itinerary-draft-fixtures";
import { selectedPlaceFixtures } from "../chat-cards/selected-place-fixtures";

const COPY = {
  zh: { first: "想看看须贺神社的画面，再安排半天巡礼。", pictures: "先看看这里的画面。", second: "把参宫桥也放进去，从四谷出发。", draft: "按你选的地点，先留下一版半日草案。" },
  en: { first: "I’d like to see the pictures of Suga Shrine, then plan a half-day visit.", pictures: "Here are the pictures of this place.", second: "Include Sangubashi too, starting from Yotsuya.", draft: "Here’s a half-day draft with the places you chose." },
  ja: { first: "須賀神社の画像を見てから、半日の巡礼を考えたい。", pictures: "まずは、この場所の画像をどうぞ。", second: "参宮橋も入れて、四ツ谷から出発したい。", draft: "選んだ場所をもとに、半日の旅程案をまとめました。" },
} as const;

/** Authored replay fixtures. The photos and draft share existing samples from separate works. */
export function historyReplayFixtures(locale: Locale): readonly HistoryReplayEntry[] {
  const copy = COPY[locale];
  return [
    { id: "request-pictures", role: "user", content: copy.first },
    { id: "picture-result", role: "assistant", content: copy.pictures, intent: "search", blocks: [{ id: "scenes-1", kind: "scenes", places: [selectedPlaceFixtures[0]] }] },
    { id: "request-draft", role: "user", content: copy.second },
    { id: "draft-result", role: "assistant", content: copy.draft, intent: "plan_route", blocks: [{ id: "draft-1", kind: "draft", draft: itineraryDraftFixture(locale) }] },
  ];
}

export function incompleteHistoryFixtures(locale: Locale, content: "scenes" | "draft"): readonly HistoryReplayEntry[] {
  return historyReplayFixtures(locale).map((entry) => ({ ...entry, blocks: entry.blocks?.map((block) => block.kind === content ? { id: block.id, kind: "unavailable", content } : block) }));
}

export function brokenHistoryImages(locale: Locale): readonly HistoryReplayEntry[] {
  const draft = itineraryDraftFixture(locale);
  const stops = draft.stops.map((stop) => ({ ...stop, place: { ...stop.place, viewpoints: stop.place.viewpoints.map((viewpoint) => ({ ...viewpoint, frames: [{ id: "missing", url: "/storybook-missing-history.webp" }] })) } }));
  return [{ id: "image-failure-draft", role: "assistant", content: COPY[locale].draft, blocks: [{ id: "draft-with-broken-images", kind: "draft", draft: { ...draft, stops } }] }];
}
