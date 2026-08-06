import { intentOf } from "./supersession";

/**
 * E2 recompute bypass (issue #273 S1.7): a checkbox reselection re-sends the
 * conversation with `selected_point_ids`, so `_dispatch_request` takes the
 * `execute_selected_route` branch and the agent never runs. The turn carries
 * no new user utterance — the body field is the whole request delta.
 */
export interface SelectedPointsBody {
  readonly selected_point_ids: readonly string[];
}

/** The bypass can never fire empty: an empty selection produces no body. */
export function selectedPointsBody(ids: readonly string[]): SelectedPointsBody | undefined {
  if (ids.length === 0) return undefined;
  return { selected_point_ids: [...ids] };
}

/** Order-insensitive match of the live selection against the last-sent ids. */
export function sameIds(selected: ReadonlySet<string>, ids: readonly string[] | undefined): boolean {
  if (ids === undefined || selected.size !== ids.length) return false;
  return ids.every((id) => selected.has(id));
}

interface PartLike {
  readonly type: string;
  readonly data?: unknown;
}

function isRecomputeData(part: PartLike): boolean {
  return part.type === "data-response" && intentOf(part.data) === "plan_selected";
}

function isToolLike(part: PartLike): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

/**
 * A bypass recompute turn: only `plan_selected` step parts, or a
 * `plan_selected` card before any step streamed — the backend always streams
 * that step for the bypass (`execute_selected_route` →
 * `chat_stream._ToolPartTranslator`) and the UI suppresses it: "没经过 agent
 * 就不演 agent 的戏". Order-independent so the step frame arriving BEFORE the
 * data part cannot flash a badge; agent-path turns that ran other tools keep
 * their badges.
 */
export function isBypassTurn(parts: readonly PartLike[]): boolean {
  const tools = parts.filter(isToolLike);
  if (tools.length > 0) return tools.every((part) => part.type === "tool-plan_selected");
  return parts.some(isRecomputeData);
}
