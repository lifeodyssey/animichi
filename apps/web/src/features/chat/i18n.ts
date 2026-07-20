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
  readonly errorCard: string;
  readonly historyError: string;
  readonly preparing: string;
  readonly foxAlt: string;
  readonly thinking: string;
  readonly waitingSubtitle: string;
  readonly footprintDetails: string;
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
  errorCard: "ごめんね、エラーが起きちゃった。もう一度ためしてみてね",
  historyError: "過去の会話を読み込めませんでした",
  preparing: "じゅんびちゅう…",
  foxAlt: "アニミチ",
  thinking: "考え中…",
  waitingSubtitle: "いま さがしてるよ…",
  footprintDetails: "詳細を見る",
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
  errorCard: "抱歉,出错了。请再试一次",
  historyError: "无法加载之前的对话",
  preparing: "准备中…",
  foxAlt: "Animichi",
  thinking: "思考中…",
  waitingSubtitle: "正在帮你找…",
  footprintDetails: "查看详情",
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
  errorCard: "Sorry, something went wrong. Please try again",
  historyError: "Couldn't load this conversation",
  preparing: "Getting ready…",
  foxAlt: "Animichi",
  thinking: "Thinking…",
  waitingSubtitle: "Looking that up…",
  footprintDetails: "View details",
};

const CHAT_DICTIONARIES: Record<Locale, ChatDict> = { ja, zh, en };

export function chatDictFor(locale: Locale): ChatDict {
  return CHAT_DICTIONARIES[locale];
}
