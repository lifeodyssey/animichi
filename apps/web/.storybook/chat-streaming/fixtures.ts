import type { UIMessage } from "ai";
import type { Locale } from "../../src/i18n/locales";
import { clarifyPart } from "../chat-cards/fixtures";

const COPY = {
  zh: {
    ask: "想去《吹响吧！上低音号》的取景地走走。",
    answer: "可以从宇治开始。沿着宇治川走，车站、桥和河边的风景就能连成一次轻松的散步。\n\n想慢慢拍照的话，我们可以少排几个点，把时间留给喜欢的场景。",
    followup: "我想走轻松一点，最好留些时间在河边拍照。",
    reply: "那就先围绕宇治川安排，不急着把每个地方都走完。你打算从哪里出发？",
    clarify: "先确认一下，你想找的是哪一部？",
    failed: "这次查询没有完成。可以稍后再试，或者先告诉我想去的城市。",
  },
  ja: {
    ask: "『響け！ユーフォニアム』の聖地を歩きたい。",
    answer: "宇治から始めよう。宇治川に沿って歩けば、駅や橋、川辺の風景をゆっくりつなげられるよ。\n\n写真を撮る時間もほしいなら、立ち寄る場所を少なめにして、お気に入りの景色を楽しもう。",
    followup: "川辺で写真を撮りながら、ゆっくり歩きたいな。",
    reply: "それなら宇治川の周りを中心にしよう。全部を急いで回らなくても大丈夫。どこから出発する？",
    clarify: "まず、探している作品を教えてね。",
    failed: "今回は検索を完了できなかったよ。少し待ってから試すか、行きたい街を教えてね。",
  },
  en: {
    ask: "I'd like to visit the filming locations from Sound! Euphonium.",
    answer: "Let's start in Uji. A walk along the river connects the station, bridges, and familiar riverside views.\n\nIf you'd like time for photos, we can keep the stops few and leave room to enjoy your favorite scenes.",
    followup: "I'd like an easy walk with plenty of time for photos by the river.",
    reply: "Then let's stay around the Uji River. There's no need to rush through every spot. Where will you be starting from?",
    clarify: "First, which title did you have in mind?",
    failed: "This search couldn't finish. You can try again later, or tell me which city you'd like to visit.",
  },
} as const;

function textMessage(id: string, role: UIMessage["role"], text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

type ToolState = "input-available" | "output-available" | "output-error";
function tool(id: string, type: string, state: ToolState): UIMessage["parts"][number] {
  const input = { title: "響け！ユーフォニアム" };
  if (state === "output-error") return { type: `tool-${type}`, toolCallId: id, state, input, errorText: "Search unavailable" };
  if (state === "input-available") return { type: `tool-${type}`, toolCallId: id, state, input };
  return { type: `tool-${type}`, toolCallId: id, state, input, output: {} };
}

export function textMessages(locale: Locale): readonly UIMessage[] {
  return [textMessage("u1", "user", COPY[locale].ask), textMessage("a1", "assistant", COPY[locale].answer)];
}

export function toolMessages(locale: Locale, state: ToolState = "output-available"): readonly UIMessage[] {
  const parts = [tool("t1", "resolve_anime", "output-available"), tool("t2", "search_bangumi", state)];
  if (state === "output-available") parts.push({ type: "text", text: COPY[locale].answer });
  if (state === "output-error") parts.push({ type: "text", text: COPY[locale].failed });
  return [textMessage("u1", "user", COPY[locale].ask), { id: "a1", role: "assistant", parts }];
}

export function retriedMessages(locale: Locale): readonly UIMessage[] {
  const failed = { type: "tool-search_bangumi", toolCallId: "t1", state: "output-error", input: {}, errorText: "Search unavailable" };
  const retried = { type: "tool-search_bangumi", toolCallId: "t2", state: "output-available", input: {}, output: {} };
  return [textMessage("u1", "user", COPY[locale].ask), { id: "a1", role: "assistant", parts: [failed, retried, { type: "text", text: COPY[locale].answer }] as UIMessage["parts"] }];
}

export function conversationMessages(locale: Locale): readonly UIMessage[] {
  return [...toolMessages(locale), textMessage("u2", "user", COPY[locale].followup), textMessage("a2", "assistant", COPY[locale].reply)];
}

export function clarifyMessages(locale: Locale): readonly UIMessage[] {
  const parts: UIMessage["parts"] = [{ type: "text", text: COPY[locale].clarify }, { type: "data-response", data: clarifyPart }];
  return [textMessage("u1", "user", COPY[locale].ask), { id: "a1", role: "assistant", parts }];
}
