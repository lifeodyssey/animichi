import type { Locale } from "../../i18n/locales";
import type { StayEstimate } from "./lib/itinerary-draft";
import { validStayEstimate } from "./lib/itinerary-draft";

const copy = {
  zh: {
    draft: "行程草案", places: "{count} 个地点", viewpoints: "{count} 处取景位置", order: "建议游览顺序",
    details: "地点详情", search: "查找草案里的地点", clearSearch: "清除查找", matches: "找到 {count} / {total} 个地点", noMatches: "没有找到，换个地点名或地区试试。",
    origin: "出发地", availableTime: "可用时间", departureTime: "出发时间", from: "从 {place} 出发",
    stay: "建议停留约 {range} 分钟", assumptions: "这版先按这些来安排",
    note: "顺序与停留时间仅供参考，实际交通耗时尚未核实。", save: "保存草案", adjust: "调整一下",
    updating: "正在调整，你可以继续看这版。", failed: "这次调整没完成，上一版还在。", retry: "再试一次",
    empty: "这份草案还没有地点", emptyBody: "可以先选几个地点，或在对话里说说想去哪里。",
  },
  en: {
    draft: "Itinerary draft", places: "{count} places", viewpoints: "{count} viewpoints", order: "Suggested visit order",
    details: "Place details", search: "Find a place in this draft", clearSearch: "Clear search", matches: "{count} of {total} places found", noMatches: "No matches. Try another place name or area.",
    origin: "Starting point", availableTime: "Available time", departureTime: "Start time", from: "From {place}",
    stay: "Suggested stay: about {range} min", assumptions: "Assumptions for this draft",
    note: "The order and stop durations are suggestions. Actual travel times have not been checked.", save: "Save draft", adjust: "Adjust draft",
    updating: "Updating your plan. This draft is still available.", failed: "The update failed. Your previous draft is still here.", retry: "Try again",
    empty: "No places in this draft yet", emptyBody: "Choose a few places, or tell us where you would like to go in chat.",
  },
  ja: {
    draft: "旅のプラン案", places: "{count}か所", viewpoints: "撮影ポイント {count}か所", order: "おすすめの巡る順番",
    details: "場所の詳細", search: "この案の場所を探す", clearSearch: "検索をクリア", matches: "{total}か所中{count}か所が一致", noMatches: "見つかりませんでした。別の場所名や地域でお試しください。",
    origin: "出発地", availableTime: "使える時間", departureTime: "出発日時", from: "{place}から出発",
    stay: "滞在の目安：約{range}分", assumptions: "この案の前提",
    note: "順番と滞在時間は目安です。実際の移動時間は未確認です。", save: "この案を保存", adjust: "調整する",
    updating: "調整中です。この案は引き続き見られます。", failed: "調整できませんでした。前の案は残っています。", retry: "もう一度",
    empty: "まだ場所がありません", emptyBody: "場所を選ぶか、行きたいところをチャットで教えてください。",
  },
};

export const itineraryDraftCopy = (locale: Locale) => copy[locale];

export function draftPlaceCount(locale: Locale, count: number): string {
  if (locale === "en" && count === 1) return "1 place";
  return copy[locale].places.replace("{count}", new Intl.NumberFormat(locale).format(count));
}

export function draftViewpointCount(locale: Locale, count: number): string {
  return copy[locale].viewpoints.replace("{count}", new Intl.NumberFormat(locale).format(count));
}

export function draftStayCopy(locale: Locale, estimate?: StayEstimate): string | null {
  if (!estimate || !validStayEstimate(estimate)) return null;
  const format = new Intl.NumberFormat(locale);
  const range = estimate.minMinutes === estimate.maxMinutes ? format.format(estimate.minMinutes) : `${format.format(estimate.minMinutes)}–${format.format(estimate.maxMinutes)}`;
  return copy[locale].stay.replace("{range}", range);
}
