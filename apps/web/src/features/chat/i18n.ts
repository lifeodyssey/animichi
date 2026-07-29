import type { Locale } from "../../i18n/locales";
import { enByok, jaByok, zhByok } from "./byok-i18n";
import type { ChatByokDict } from "./byok-i18n";
import {
  enClarify,
  enDeparture,
  enLocation,
  enPhoto,
  jaClarify,
  jaDeparture,
  jaLocation,
  jaPhoto,
  zhClarify,
  zhDeparture,
  zhLocation,
  zhPhoto,
} from "./clarify-i18n";
import type {
  ChatClarifyDict,
  ChatDepartureDict,
  ChatLocationDict,
  ChatPhotoDict,
} from "./clarify-i18n";
import { enErrorStates, jaErrorStates, zhErrorStates } from "./error-states-i18n";
import type { ChatErrorStatesDict } from "./error-states-i18n";
import { enRoute, jaRoute, zhRoute } from "./route-i18n";
import type { ChatRouteDict } from "./route-i18n";
import { enSearch, jaSearch, zhSearch } from "./search-i18n";
import type { ChatSearchDict } from "./search-i18n";

export type { ChatRouteDict } from "./route-i18n";
export type { ChatSearchDict } from "./search-i18n";
export type { ChatByokDict } from "./byok-i18n";
export type {
  ChatClarifyDict,
  ChatDepartureDict,
  ChatLocationDict,
  ChatPhotoDict,
} from "./clarify-i18n";

export type { ChatErrorStatesDict } from "./error-states-i18n";

/** Tools whose step badges surface to the user as localized progress copy. */
export const TOOL_STEP_KEYS = [
  "resolve_anime",
  "search_bangumi",
  "search_nearby",
  "plan_route",
  "plan_selected",
  "plan_multi",
  "web_search",
] as const;

export type ToolStepKey = (typeof TOOL_STEP_KEYS)[number];

/**
 * Explicit deny-list: internal agent mechanics that must never appear in the
 * badge stream. `translate_anime_title` is plumbing (the agent translating a
 * title to query the catalog), not user-visible progress.
 */
export const HIDDEN_TOOL_STEPS: ReadonlySet<string> = new Set([
  "translate_anime_title",
]);

/** In-character progress copy for tool step badges. */
export interface ChatToolStepsDict {
  readonly labels: Readonly<Record<ToolStepKey, string>>;
  readonly fallback: string;
  /** Screen-reader suffix for a step the agent re-ran after a recoverable retry. */
  readonly retried: string;
}

/** Turnstile challenge copy (issue #281 S1.9): the widget label plus the
 * retryable rejection the edge Worker returns for a bad or expired token. */
export interface ChatTurnstileDict {
  readonly label: string;
  readonly failed: string;
  readonly retry: string;
}

const jaTurnstile: ChatTurnstileDict = {
  label: "かんたんな確認",
  failed: "確認がうまくいかなかったみたい。もう一度ためしてね",
  retry: "もう一度ためす",
};

const zhTurnstile: ChatTurnstileDict = {
  label: "简单的验证",
  failed: "验证没通过,再试一次就好",
  retry: "再试一次",
};

const enTurnstile: ChatTurnstileDict = {
  label: "A quick check",
  failed: "That check didn't go through. Give it another try",
  retry: "Try again",
};

/** Chat-page copy, kept feature-local to avoid the shared dictionary hot file. */
export interface ChatDict {
  readonly greeting: string;
  readonly chips: readonly [string, string, string];
  readonly inputPlaceholder: string;
  readonly send: string;
  readonly errorBanner: string;
  readonly retry: string;
  readonly historyFootprint: string;
  readonly fallbackCard: string;
  readonly historyError: string;
  readonly preparing: string;
  readonly foxAlt: string;
  readonly thinking: string;
  readonly waitingSubtitle: string;
  readonly footprintDetails: string;
  /** E1 badge on a superseded living-document card (issues #271/#273). */
  readonly previousVersion: string;
  readonly errorStates: ChatErrorStatesDict;
  readonly toolSteps: ChatToolStepsDict;
  readonly search: ChatSearchDict;
  readonly turnstile: ChatTurnstileDict;
  readonly route: ChatRouteDict;
  readonly clarify: ChatClarifyDict;
  readonly departure: ChatDepartureDict;
  readonly location: ChatLocationDict;
  readonly photo: ChatPhotoDict;
  readonly byok: ChatByokDict;
}

const jaToolSteps: ChatToolStepsDict = {
  labels: {
    resolve_anime: "作品をしらべてるよ…",
    search_bangumi: "聖地をさがしてるよ…",
    search_nearby: "近くの聖地をさがしてるよ…",
    plan_route: "ルートを組んでるよ…",
    plan_selected: "えらんだ場所でルートを組んでるよ…",
    plan_multi: "まとめてルートを組んでるよ…",
    web_search: "ネットでしらべてるよ…",
  },
  fallback: "じゅんびしてるよ…",
  retried: "やりなおしたよ",
};

const zhToolSteps: ChatToolStepsDict = {
  labels: {
    resolve_anime: "在查这部作品…",
    search_bangumi: "在找圣地…",
    search_nearby: "在找附近的圣地…",
    plan_route: "在规划路线…",
    plan_selected: "在按你选的地点排路线…",
    plan_multi: "在把路线排到一起…",
    web_search: "在网上查一查…",
  },
  fallback: "在准备中…",
  retried: "已重试",
};

const enToolSteps: ChatToolStepsDict = {
  labels: {
    resolve_anime: "Looking up the title…",
    search_bangumi: "Finding the spots…",
    search_nearby: "Searching nearby…",
    plan_route: "Planning the route…",
    plan_selected: "Routing your picks…",
    plan_multi: "Weaving routes together…",
    web_search: "Searching the web…",
  },
  fallback: "Working on it…",
  retried: "retried",
};

const ja: ChatDict = {
  greeting: "アニミチだよ。どのアニメの聖地をめぐってみたい?",
  chips: [
    "響け!ユーフォニアムの聖地",
    "君の名は。のルートを組んで",
    "近くの聖地をさがして",
  ],
  inputPlaceholder: "作品名やエリアを話しかけてね…",
  send: "送信",
  errorBanner: "サーバーに接続できません",
  retry: "再試行",
  historyFootprint: "これまでのやり取り",
  fallbackCard: "この内容はうまく表示できませんでした",
  historyError: "過去の会話を読み込めませんでした",
  preparing: "じゅんびちゅう…",
  foxAlt: "アニミチ",
  thinking: "考え中…",
  waitingSubtitle: "いま さがしてるよ…",
  footprintDetails: "詳細を見る",
  previousVersion: "以前の版",
  errorStates: jaErrorStates,
  toolSteps: jaToolSteps,
  search: jaSearch,
  turnstile: jaTurnstile,
  route: jaRoute,
  clarify: jaClarify,
  departure: jaDeparture,
  location: jaLocation,
  photo: jaPhoto,
  byok: jaByok,
};

const zh: ChatDict = {
  greeting: "我是 Animichi。想去哪部作品的圣地巡礼?",
  chips: ["吹响吧!上低音号的圣地", "帮我规划你的名字。的路线", "找找附近的圣地"],
  inputPlaceholder: "告诉我作品名或想去的地区…",
  send: "发送",
  errorBanner: "无法连接服务器",
  retry: "重试",
  historyFootprint: "之前的对话",
  fallbackCard: "这段内容暂时无法显示",
  historyError: "无法加载之前的对话",
  preparing: "准备中…",
  foxAlt: "Animichi",
  thinking: "思考中…",
  waitingSubtitle: "正在帮你找…",
  footprintDetails: "查看详情",
  previousVersion: "旧版本",
  errorStates: zhErrorStates,
  toolSteps: zhToolSteps,
  search: zhSearch,
  turnstile: zhTurnstile,
  route: zhRoute,
  clarify: zhClarify,
  departure: zhDeparture,
  location: zhLocation,
  photo: zhPhoto,
  byok: zhByok,
};

const en: ChatDict = {
  greeting: "I'm Animichi. Which anime's real-world spots shall we visit?",
  chips: [
    "Hibike! Euphonium spots",
    "Plan a Your Name. route",
    "Find spots near me",
  ],
  inputPlaceholder: "Tell me a title or an area…",
  send: "Send",
  errorBanner: "Can't reach the server",
  retry: "Retry",
  historyFootprint: "Earlier conversation",
  fallbackCard: "This part could not be displayed",
  historyError: "Couldn't load this conversation",
  preparing: "Getting ready…",
  foxAlt: "Animichi",
  thinking: "Thinking…",
  waitingSubtitle: "Looking that up…",
  footprintDetails: "View details",
  previousVersion: "Previous version",
  errorStates: enErrorStates,
  toolSteps: enToolSteps,
  search: enSearch,
  turnstile: enTurnstile,
  route: enRoute,
  clarify: enClarify,
  departure: enDeparture,
  location: enLocation,
  photo: enPhoto,
  byok: enByok,
};

const CHAT_DICTIONARIES: Record<Locale, ChatDict> = { ja, zh, en };

export function chatDictFor(locale: Locale): ChatDict {
  return CHAT_DICTIONARIES[locale];
}

function isToolStepKey(name: string): name is ToolStepKey {
  return (TOOL_STEP_KEYS as readonly string[]).includes(name);
}

export function toolStepLabel(dict: ChatDict, name: string): string {
  if (isToolStepKey(name)) return dict.toolSteps.labels[name];
  return dict.toolSteps.fallback;
}
