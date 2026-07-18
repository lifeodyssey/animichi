import type { Locale } from "../../i18n/locales";

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
  readonly preparing: string;
}

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
  preparing: "じゅんびちゅう…",
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
  preparing: "准备中…",
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
  preparing: "Getting ready…",
};

const CHAT_DICTIONARIES: Record<Locale, ChatDict> = { ja, zh, en };

export function chatDictFor(locale: Locale): ChatDict {
  return CHAT_DICTIONARIES[locale];
}
