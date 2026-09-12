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
  readonly actions: Readonly<Record<ToolStepKey, string>>;
  readonly fallback: string;
  readonly actionFallback: string;
  readonly done: string;
  readonly failed: string;
  /** Visible suffix for a step the agent re-ran after a recoverable retry. */
  readonly retried: string;
}

export const jaToolSteps: ChatToolStepsDict = {
  labels: {
    resolve_anime: "作品をしらべてるよ…",
    search_bangumi: "聖地をさがしてるよ…",
    search_nearby: "近くの聖地をさがしてるよ…",
    plan_route: "ルートを組んでるよ…",
    plan_selected: "えらんだ場所でルートを組んでるよ…",
    plan_multi: "まとめてルートを組んでるよ…",
    web_search: "ネットでしらべてるよ…",
  },
  actions: {
    resolve_anime: "作品の確認", search_bangumi: "聖地の検索", search_nearby: "近くの聖地の検索",
    plan_route: "ルートの作成", plan_selected: "選んだ場所のルート作成", plan_multi: "ルートの組み合わせ", web_search: "ウェブ検索",
  },
  fallback: "じゅんびしてるよ…",
  actionFallback: "処理",
  done: "完了",
  failed: "完了できなかったよ",
  retried: "やりなおしたよ",
};

export const zhToolSteps: ChatToolStepsDict = {
  labels: {
    resolve_anime: "在查这部作品…",
    search_bangumi: "在找圣地…",
    search_nearby: "在找附近的圣地…",
    plan_route: "在规划路线…",
    plan_selected: "在按你选的地点排路线…",
    plan_multi: "在把路线排到一起…",
    web_search: "在网上查一查…",
  },
  actions: {
    resolve_anime: "确认作品", search_bangumi: "查找圣地", search_nearby: "查找附近的圣地",
    plan_route: "规划路线", plan_selected: "按所选地点排路线", plan_multi: "组合路线", web_search: "查询网上资料",
  },
  fallback: "在准备中…",
  actionFallback: "处理请求",
  done: "已完成",
  failed: "未完成",
  retried: "已重试",
};

export const enToolSteps: ChatToolStepsDict = {
  labels: {
    resolve_anime: "Looking up the title…",
    search_bangumi: "Finding the spots…",
    search_nearby: "Searching nearby…",
    plan_route: "Planning the route…",
    plan_selected: "Routing your picks…",
    plan_multi: "Weaving routes together…",
    web_search: "Searching the web…",
  },
  actions: {
    resolve_anime: "Title lookup", search_bangumi: "Location search", search_nearby: "Nearby location search",
    plan_route: "Route planning", plan_selected: "Route for your picks", plan_multi: "Route combination", web_search: "Web search",
  },
  fallback: "Working on it…",
  actionFallback: "Request",
  done: "completed",
  failed: "not completed",
  retried: "retried",
};
