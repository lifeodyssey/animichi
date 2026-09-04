/**
 * Every tool one turn may call, in Python's registration order (#1287).
 *
 * The order is not cosmetic: it is the order `animichi_agent.py` built
 * `tools=[*ANIMICHI_TOOLS, *WEB_TOOLS]` in, which is the order the model sees
 * them listed and the order the system prompt walks — resolve, then fetch, then
 * search by place, then route what was found, and only then the two tools that
 * leave the catalog. Keeping it identical is what lets the eval trajectories
 * and the prompt survive the rewrite unchanged.
 *
 * This module is the ONLY place that knows the full set. `catalogToolbox`
 * still owns its four, because they share a client and a session; the two web
 * tools share nothing with them and nothing with each other, so they are built
 * here from their own ports rather than given a second toolbox of two.
 */

import type { TurnTool } from "../session/turn-toolbox.ts";
import { catalogToolbox } from "./catalog-toolbox.ts";
import type { CatalogClient } from "./catalog-client.ts";
import type { CatalogToolSession } from "./catalog-tool-session.ts";
import type { TitleTranslator } from "./title-translation.ts";
import { translateTitleTool } from "./translate-title-tool.ts";
import { webSearchTool } from "./web-search-tool.ts";
import type { WebSearcher } from "./web-searcher.ts";

/** What one turn brings to its tools: a catalog, its own state, and two ports. */
export interface TurnToolParts {
  readonly catalog: CatalogClient;
  readonly session: CatalogToolSession;
  readonly search: WebSearcher;
  readonly translate: TitleTranslator;
}

/** The six tools, bound to one turn. */
export function agentToolbox(parts: TurnToolParts): readonly TurnTool[] {
  return [
    ...catalogToolbox(parts.catalog, parts.session),
    webSearchTool(parts.search),
    translateTitleTool(parts.translate),
  ];
}
