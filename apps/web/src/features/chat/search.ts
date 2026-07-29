/** `/chat` entry search params: `?q=` (A2), `?session=` (A3), `?route=` (A2b),
 * `?settings=byok` (#284 T8 deep-link: open the BYOK panel on arrival). */
export interface ChatSearch {
  readonly q?: string;
  readonly session?: string;
  readonly route?: string;
  readonly settings?: "byok";
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseChatSearch(input: Record<string, unknown>): ChatSearch {
  return {
    q: stringParam(input.q),
    session: stringParam(input.session),
    route: stringParam(input.route),
    settings: input.settings === "byok" ? "byok" : undefined,
  };
}
