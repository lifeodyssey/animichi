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
  fallback: "じゅんびしてるよ…",
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
  fallback: "在准备中…",
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
  fallback: "Working on it…",
  retried: "retried",
};
