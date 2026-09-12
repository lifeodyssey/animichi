import type { Locale } from "../../src/i18n/locales";
import type { ConversationSummary } from "../../src/features/chat/use-conversation-list";

const CONTENT = {
  zh: [
    ["《你的名字。》东京半日巡礼", "从四谷出发，想把须贺神社和参宫桥放在一起。"],
    ["去宇治看看《吹响！上低音号》", "一天时间，沿河慢慢走。"],
    ["镰仓的海边场景", "想找电车经过海边的那个画面。"],
    ["《孤独摇滚！》下北泽散步", "周末下午去，可以帮我看看有哪些地点吗？"],
    ["飞驒的取景地在哪里", "先看看有哪些地方。"],
  ],
  en: [
    ["A half day in Tokyo for Your Name", "Start in Yotsuya and visit Suga Shrine and Sangubashi."],
    ["Sound! Euphonium in Uji", "A full day for a relaxed walk along the river."],
    ["Seaside scenes in Kamakura", "Looking for the scene with a train beside the sea."],
    ["Bocchi the Rock! in Shimokitazawa", "Which places could I visit on a weekend afternoon?"],
    ["Finding scenes in Hida", "Let’s see which places are there."],
  ],
  ja: [
    ["『君の名は。』東京の半日巡礼", "四ツ谷から須賀神社と参宮橋を回りたい。"],
    ["『響け！ユーフォニアム』の宇治へ", "一日かけて、川沿いをゆっくり歩きたい。"],
    ["鎌倉の海辺のシーン", "電車が海のそばを走る場面を探しています。"],
    ["『ぼっち・ざ・ろっく！』下北沢散歩", "週末の午後に行ける場所を見てみたい。"],
    ["飛驒の舞台を探す", "まずはどんな場所があるか見てみたい。"],
  ],
} as const;

/** Authored conversation examples; these are not retrieved sessions or catalog claims. */
export function recentConversationFixtures(locale: Locale): readonly ConversationSummary[] {
  return CONTENT[locale].map(([title, subtitle], index) => ({ id: `recent-example-${String(index + 1)}`, title, subtitle }));
}

export function manyConversationFixtures(locale: Locale): readonly ConversationSummary[] {
  const examples = CONTENT[locale];
  return Array.from({ length: 60 }, (_, index) => {
    const [title, subtitle] = examples[index % examples.length] ?? examples[0];
    return { id: `many-example-${String(index)}`, title: `${title} · ${String(index + 1)}`, subtitle };
  });
}
