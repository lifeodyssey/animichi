import type { ChatDataPart } from "@animichi/contract";
import type { Locale } from "../../i18n/locales";
import { intentFamily } from "./registry";

interface SkeletonCopy {
  readonly search: string;
  readonly route: string;
  readonly clarify: string;
  readonly reply: string;
  readonly incomplete: string;
}

const COPY: Readonly<Record<Locale, SkeletonCopy>> = {
  zh: { search: "正在接收地点信息", route: "正在接收行程内容", clarify: "正在接收待确认的信息", reply: "正在接收回复", incomplete: "这段内容没能完整接收" },
  ja: { search: "場所の情報を受信しています", route: "旅程を受信しています", clarify: "確認内容を受信しています", reply: "返答を受信しています", incomplete: "内容を最後まで受け取れませんでした" },
  en: { search: "Receiving location details", route: "Receiving the itinerary", clarify: "Receiving a clarification", reply: "Receiving the reply", incomplete: "The full content wasn’t received" },
};

export function skeletonCopy(locale: Locale): SkeletonCopy {
  return COPY[locale];
}

/** An intent names the incoming content, not the tool or its progress. */
export function skeletonLabel(intent: ChatDataPart["intent"], locale: Locale): string {
  const copy = skeletonCopy(locale);
  const family = intentFamily(intent);
  if (family === "search") return copy.search;
  if (family === "route") return copy.route;
  if (family === "clarify") return copy.clarify;
  return copy.reply;
}
