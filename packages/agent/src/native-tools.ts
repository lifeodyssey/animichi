import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { PilgrimageToolContext } from "./tool-context.ts";
import { planRoute } from "./plan-route.ts";
import { resolveAnime } from "./resolve-anime.ts";
import { respond } from "./respond.ts";
import { searchBangumi } from "./search-bangumi.ts";
import { searchNearby } from "./search-nearby.ts";
import { translateAnimeTitle } from "./translate-anime-title.ts";
import { webSearch } from "./web-search.ts";

/**
 * The seven production tools in the order the harness advertises them. A tuple
 * literal, never built from object keys or a set: the advertised order is part
 * of the serialized request prefix, so iteration order must not decide it.
 */
export const NATIVE_TOOLS: readonly AgentHarnessTool<PilgrimageToolContext>[] = [
  resolveAnime, searchBangumi, searchNearby, planRoute, translateAnimeTitle, webSearch, respond,
];

/** The advertised tool names, in advertised order. */
export const NATIVE_TOOL_ORDER: readonly string[] = NATIVE_TOOLS.map((tool) => tool.name);
