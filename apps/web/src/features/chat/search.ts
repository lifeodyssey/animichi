import { stringParam } from "../../lib/search-params";

/** `/chat` entry search params: `?q=` (A2), `?session=` (A3), `?route=` (A2b). */
export interface ChatSearch {
  readonly q?: string;
  readonly session?: string;
  readonly route?: string;
}

export function parseChatSearch(input: Record<string, unknown>): ChatSearch {
  return {
    q: stringParam(input.q),
    session: stringParam(input.session),
    route: stringParam(input.route),
  };
}
