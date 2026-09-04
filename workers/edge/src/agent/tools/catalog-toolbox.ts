/**
 * The four catalog tools one session hands to pi.
 *
 * This is the registration surface `AgentSession` (#1252) calls: give it a
 * catalog client and the session state, get back the `TurnTool[]` that go on
 * the agent's `tools` (spec §五, W1 "4 个 catalog 工具"). Nothing here reaches
 * for a binding or a clock itself — both arrive through `catalogToolbox`, so
 * every tool stays testable without Cloudflare. `budget` defaults to the ported
 * 85-second per-tool deadline and is a parameter only so a test can supply one
 * that has already elapsed.
 */

import type { TurnTool } from "../session/turn-toolbox.ts";
import type { CatalogClient } from "./catalog-client.ts";
import { toolExecutionBudget } from "./catalog-timeouts.ts";
import type { ToolBudget } from "./catalog-timeouts.ts";
import type { CatalogToolSession } from "./catalog-tool-session.ts";
import { planRouteTool } from "./plan-route-tool.ts";
import { resolveAnimeTool } from "./resolve-anime-tool.ts";
import { searchBangumiTool } from "./search-bangumi-tool.ts";
import { searchNearbyTool } from "./search-nearby-tool.ts";

/**
 * Every catalog tool, bound to one turn's catalog and session state.
 *
 * The order is the order Python registered them in (`animichi_tools.py::TOOLS`)
 * and the order the system prompt walks: resolve, then fetch, then search by
 * place, then route what was found.
 */
export function catalogToolbox(
  catalog: CatalogClient,
  session: CatalogToolSession,
  budget: ToolBudget = toolExecutionBudget,
): readonly TurnTool[] {
  return [
    resolveAnimeTool(catalog, session, budget),
    searchBangumiTool(catalog, session, budget),
    searchNearbyTool(catalog, session, budget),
    planRouteTool(catalog, session, budget),
  ];
}
