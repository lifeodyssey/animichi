import type { Locale } from "../../i18n/locales";

const copy = {
  zh: {
    title: "这次想怎么逛？", origin: "出发地", originPlaceholder: "车站、酒店或一个地点",
    availableTime: "可以逛多久", availableTimePlaceholder: "比如 3 小时，或下午两点前",
    departureTime: "出发时间", departureTimePlaceholder: "比如明天上午 10 点",
    halfDay: "半天", fullDay: "一天", custom: "自己填", edit: "修改", addTime: "加上出发时间",
    continue: "生成行程建议", draft: "先给一版建议", busy: "正在整理建议…",
  },
  en: {
    title: "How would you like to explore?", origin: "Starting point", originPlaceholder: "A station, hotel or place",
    availableTime: "Time to explore", availableTimePlaceholder: "e.g. 3 hours, or until 2 pm",
    departureTime: "When to start", departureTimePlaceholder: "e.g. tomorrow at 10 am",
    halfDay: "Half day", fullDay: "Full day", custom: "Custom", edit: "Edit", addTime: "Add a start time",
    continue: "Suggest an itinerary", draft: "Make a first draft", busy: "Preparing suggestions…",
  },
  ja: {
    title: "どんなふうに巡る？", origin: "出発地", originPlaceholder: "駅、ホテル、場所の名前",
    availableTime: "巡れる時間", availableTimePlaceholder: "例：3時間、午後2時まで",
    departureTime: "出発日時", departureTimePlaceholder: "例：明日の午前10時",
    halfDay: "半日", fullDay: "1日", custom: "その他", edit: "変更", addTime: "出発日時を追加",
    continue: "プランを提案して", draft: "まずは案を見てみる", busy: "プランを考えています…",
  },
};

export type TripConditionsCopy = typeof copy.zh;
export const tripConditionsCopy = (locale: Locale): TripConditionsCopy => copy[locale];
