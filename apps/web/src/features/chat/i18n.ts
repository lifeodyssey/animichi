import type { Locale } from "../../i18n/locales";

/** In-character copy for the nine D1-D9 fallback states (issue #272 S1.6). */
export interface ChatErrorStatesDict {
  readonly d1Title: string;
  readonly d1Hint: string;
  readonly d1Subtitle: string;
  readonly d2Title: string;
  readonly d2Hint: string;
  readonly d3Notice: string;
  readonly d3Chip: string;
  readonly d4Message: string;
  readonly d4Retry: string;
  readonly d5Message: string;
  readonly d5Retry: string;
  readonly d6Message: string;
  readonly d6Retry: string;
  readonly d7Message: string;
  readonly d7Open: string;
  readonly d8Message: string;
  readonly d8Login: string;
  readonly d8Resume: string;
  readonly d9Episode: string;
  readonly d10Message: string;
  readonly d10Retry: string;
  readonly d11Message: string;
  readonly d11Login: string;
}

/** Copy for the C3a/C3b search result cards and static map (issue #261 S1.4). */
export interface ChatSearchDict {
  readonly select: string;
  readonly spotCount: string;
  readonly areaFallback: string;
  readonly mapLabel: string;
}

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
  readonly errorStates: ChatErrorStatesDict;
  readonly toolSteps: ChatToolStepsDict;
  readonly search: ChatSearchDict;
  readonly turnstile: ChatTurnstileDict;
}

const jaSearch: ChatSearchDict = {
  select: "この聖地をえらぶ",
  spotCount: "{count}件",
  areaFallback: "エリア{n}",
  mapLabel: "聖地マップ",
};

const zhSearch: ChatSearchDict = {
  select: "选择这个圣地",
  spotCount: "{count} 处",
  areaFallback: "区域{n}",
  mapLabel: "圣地地图",
};

const enSearch: ChatSearchDict = {
  select: "Select this spot",
  spotCount: "{count} spots",
  areaFallback: "Area {n}",
  mapLabel: "Spot map",
};

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

const jaErrorStates: ChatErrorStatesDict = {
  d1Title: "ごめんね、その作品が見つからなかった…",
  d1Hint: "つづりを確かめるか、原題でためしてみて。あらすじを教えてくれたら当ててみるよ",
  d1Subtitle: "うーん、見つからない…",
  d2Title: "この作品はまだ Anitabi に聖地が登録されていないみたい",
  d2Hint: "べつの作品でさがしてみる?",
  d3Notice: "スポットが少なめだから、みじかいおさんぽになりそう",
  d3Chip: "近くの別作品も足す?",
  d4Message: "接続が切れました",
  d4Retry: "再試行",
  d5Message: "時間がかかりすぎているみたい",
  d5Retry: "もう一度",
  d6Message: "ごめんね、うまく答えられなかった。言い方を変えてみてね",
  d6Retry: "もう一度ためす",
  d7Message: "地図をよみこめなかった…",
  d7Open: "地図アプリで開く",
  d8Message: "セッションが切れちゃった。ログインし直すと、この会話のつづきから話せるよ",
  d8Login: "ログインする",
  d8Resume: "つづきを読み込む",
  d9Episode: "第{ep}話",
  d10Message: "ちょっと混み合ってるみたい。少し待ってね",
  d10Retry: "もう一度おくる",
  d11Message: "今日はここまで。ログインすると、このつづきから一緒に旅の計画を立てられるよ",
  d11Login: "ログインする",
};

const zhErrorStates: ChatErrorStatesDict = {
  d1Title: "抱歉,没找到这部作品…",
  d1Hint: "检查一下拼写,或试试原文标题。告诉我一句剧情,我来猜猜看",
  d1Subtitle: "嗯…找不到呢…",
  d2Title: "这部作品好像还没有圣地被收录进 Anitabi",
  d2Hint: "要不要换部作品试试?",
  d3Notice: "地点有点少,会是一段短短的散步",
  d3Chip: "要不要把附近别的作品也加进来?",
  d4Message: "连接断开了",
  d4Retry: "重试",
  d5Message: "花的时间有点太久了",
  d5Retry: "再试一次",
  d6Message: "抱歉,这次没答好。换个说法试试吧",
  d6Retry: "再试一次",
  d7Message: "地图加载不出来…",
  d7Open: "在地图应用中打开",
  d8Message: "会话过期了。重新登录就能接着聊,内容不会丢",
  d8Login: "去登录",
  d8Resume: "继续加载",
  d9Episode: "第{ep}集",
  d10Message: "现在有点挤,稍微等一下哦",
  d10Retry: "再发一次",
  d11Message: "今天就聊到这儿啦。登录之后,就能接着一起把这趟旅程规划下去",
  d11Login: "去登录",
};

const enErrorStates: ChatErrorStatesDict = {
  d1Title: "Sorry, I couldn't find that title…",
  d1Hint: "Check the spelling or try the original title. Tell me a bit of the plot and I'll take a guess",
  d1Subtitle: "Hmm, nothing turned up…",
  d2Title: "This work doesn't seem to have any spots on Anitabi yet",
  d2Hint: "Want to try another title?",
  d3Notice: "Only a few spots, so this will be a short stroll",
  d3Chip: "Add a nearby work too?",
  d4Message: "The connection dropped",
  d4Retry: "Retry",
  d5Message: "This is taking too long",
  d5Retry: "Try again",
  d6Message: "Sorry, I couldn't quite answer that. Try phrasing it differently",
  d6Retry: "Try again",
  d7Message: "The map wouldn't load…",
  d7Open: "Open in a map app",
  d8Message: "Your session expired. Sign in again to pick up right where we left off",
  d8Login: "Sign in",
  d8Resume: "Reload the conversation",
  d9Episode: "Ep. {ep}",
  d10Message: "Things are a little busy — hang on a moment",
  d10Retry: "Send again",
  d11Message: "That's it for today. Sign in and we can keep planning this trip together",
  d11Login: "Sign in",
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
  errorStates: jaErrorStates,
  toolSteps: jaToolSteps,
  search: jaSearch,
  turnstile: jaTurnstile,
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
  errorStates: zhErrorStates,
  toolSteps: zhToolSteps,
  search: zhSearch,
  turnstile: zhTurnstile,
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
  errorStates: enErrorStates,
  toolSteps: enToolSteps,
  search: enSearch,
  turnstile: enTurnstile,
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
