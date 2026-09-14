import type { Locale } from "../../i18n/locales";

const COPY = {
  zh: {
    heading: "最近会话", untitled: "未命名会话", loading: "正在加载会话…", refreshing: "正在更新列表…",
    empty: "还没有最近会话", emptyHint: "开始聊聊，之后可以从这里接着看。",
    failed: "最近会话暂时没加载出来", failedHint: "可以再试一次。", stale: "列表暂时没更新，已有会话仍可打开。", retry: "重新加载",
  },
  en: {
    heading: "Recent conversations", untitled: "Untitled conversation", loading: "Loading conversations…", refreshing: "Updating the list…",
    empty: "No conversations yet", emptyHint: "Start a conversation and pick it up here later.",
    failed: "Conversations couldn’t be loaded", failedHint: "You can try again.", stale: "The list couldn’t be updated. You can still open these conversations.", retry: "Try again",
  },
  ja: {
    heading: "最近の会話", untitled: "タイトルのない会話", loading: "会話を読み込み中…", refreshing: "一覧を更新中…",
    empty: "まだ会話がありません", emptyHint: "会話を始めると、ここから続きを開けます。",
    failed: "最近の会話を読み込めませんでした", failedHint: "もう一度お試しください。", stale: "一覧を更新できませんでした。表示中の会話は開けます。", retry: "再読み込み",
  },
} as const;

export function recentConversationsCopy(locale: Locale) { return COPY[locale]; }
