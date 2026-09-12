import type { Locale } from "../../src/i18n/locales";
import type { ItineraryDraftPlan } from "../../src/features/chat/lib/itinerary-draft";
import { emptyTravelConditions } from "../../src/features/chat/lib/trip-conditions";
import { itineraryDraftFixture } from "./itinerary-draft-fixtures";

/** Capacity-only fixture: repeat existing Tokyo samples with explicit example suffixes.
 * These 30 ids are synthetic, not 30 distinct catalog places or a feasible itinerary. */
export function manyItineraryFixture(locale: Locale): ItineraryDraftPlan {
  const base = itineraryDraftFixture(locale), example = { zh: "样例", en: "example", ja: "表示例" }[locale];
  const stops = Array.from({ length: 30 }, (_, index) => {
    const source = base.stops[index % base.stops.length] ?? base.stops[0], suffix = String(index + 1).padStart(2, "0");
    return { ...source, place: { ...source.place, id: `example-${suffix}`, name: `${source.place.name} · ${example} ${suffix}` } };
  });
  return { ...base, id: `many-places-${locale}`, title: { zh: "我的巡礼草案", en: "My pilgrimage draft", ja: "聖地めぐりのプラン案" }[locale], conditions: emptyTravelConditions, introduction: undefined, stops };
}
