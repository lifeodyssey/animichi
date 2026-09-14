import type { Locale } from "../../src/i18n/locales";
import type { ItineraryDraftPlan } from "../../src/features/chat/lib/itinerary-draft";
import { selectedPlaceFixtures } from "./selected-place-fixtures";
import type { SelectedPlace } from "../../src/features/chat/lib/selected-places";

/** Same Tokyo fixture pool, plus the existing Yotsuya station example with no supplied image.
 * The image-less grouping is illustrative. These are not a complete catalog or recommendations. */
export const draftPlaceCandidates: readonly SelectedPlace[] = [selectedPlaceFixtures[0], selectedPlaceFixtures[1], { id: "yotsuya", name: "四ツ谷駅", city: "新宿区", viewpoints: [{ id: "yotsuya-example", frames: [] }] }];

/** Existing Tokyo place names and images from separate works; no common anime title is implied.
 * Suggestions, grouping and stay ranges are illustrative UI data, not a verified itinerary. */
const text = {
  zh: { title: "东京半日巡礼", origin: "四谷站", time: "半天", intro: "先到须贺神社，再去参宫桥。把时间留给你选的画面，不用急着赶下一站。", first: "先看你选的两处取景位置，留些时间慢慢拍。", second: "接着去看看这段铁路旁的风景。" },
  en: { title: "A half day in Tokyo", origin: "Yotsuya Station", time: "Half day", intro: "Start at Suga Shrine, then visit Sangubashi. Leave time for the scenes you picked, without rushing to the next stop.", first: "Spend some time with the two viewpoints you chose.", second: "Continue to the scenery beside the railway." },
  ja: { title: "東京、半日の聖地めぐり", origin: "四ツ谷駅", time: "半日", intro: "須賀神社から参宮橋へ。次の場所を急がず、選んだ画面をゆっくり楽しむ案です。", first: "選んだ2か所の撮影ポイントで、ゆっくり写真を。", second: "続いて、線路沿いの景色を見に行きましょう。" },
};

export function itineraryDraftFixture(locale: Locale) {
  const copy = text[locale];
  return { id: "tokyo-draft-1", title: copy.title, conditions: { origin: copy.origin, availableTime: copy.time, departureTime: "" }, introduction: copy.intro, assumptions: [], stops: [
    { place: selectedPlaceFixtures[0], suggestion: copy.first, stayEstimate: { minMinutes: 20, maxMinutes: 40 } },
    { place: selectedPlaceFixtures[1], suggestion: copy.second, stayEstimate: { minMinutes: 15, maxMinutes: 25 } },
  ] as const } satisfies ItineraryDraftPlan;
}
