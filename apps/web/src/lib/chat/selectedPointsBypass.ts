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

function intentOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("intent" in data)) return undefined;
  const { intent } = data;
  return typeof intent === "string" ? intent : undefined;
}

interface PartLike {
  readonly type: string;
  readonly data?: unknown;
}

/** A bypass recompute's card: `plan_selected` streamed with no tool pipeline. */
export function hasRecomputePart(parts: readonly PartLike[]): boolean {
  return parts.some((part) => part.type === "data-response" && intentOf(part.data) === "plan_selected");
}
