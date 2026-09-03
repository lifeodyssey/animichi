/**
 * The edge half of the ONE zod↔JSON-Schema seam (spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §二, "schema 边界").
 * Decision: contract zod is the source, because three of the four tools carry
 * constraints `packages/contract` already declares for the catalog's own
 * requests; `packages/contract/scripts/emit-tool-schemas.ts` converts them once
 * and this module only attaches the matching static type.
 *
 * Nothing here re-declares a constraint, and nothing here loads zod: the
 * generated module is import-free and the parameter types arrive as `import
 * type`, so every file stays loadable under node:test.
 */

import type { TSchema } from "typebox";
import type {
  PlanRouteParameters,
  ResolveAnimeParameters,
  SearchBangumiParameters,
  SearchNearbyParameters,
} from "@animichi/contract/agent-tool-parameters";
import { CATALOG_TOOL_SCHEMAS } from "@animichi/contract/agent-tool-schemas";

/**
 * A generated JSON Schema carrying the static type of the arguments it accepts.
 *
 * `~unsafe` is TypeBox's own escape hatch for a schema it did not build
 * (`typebox/build/type/types/unsafe.d.mts`): `Static<T>` resolves it to `Params`
 * without the schema needing TypeBox's runtime symbols. pi validates plain JSON
 * Schema on that same basis — `validateToolArguments` explicitly branches on the
 * absence of `Symbol.for("TypeBox.Kind")` — so this stays a type-level brand and
 * adds no key to the document the provider receives.
 */
export interface ToolParameters<Params> extends TSchema {
  readonly "~unsafe": Params;
}

/** Brand one generated schema with the parameter type the contract inferred. */
export function toolParameters<Params>(schema: object): ToolParameters<Params> {
  return schema as ToolParameters<Params>;
}

/** `resolve_anime`'s parameters. */
export const resolveAnimeParameters = toolParameters<ResolveAnimeParameters>(
  CATALOG_TOOL_SCHEMAS.resolve_anime,
);

/** `search_bangumi`'s parameters. */
export const searchBangumiParameters = toolParameters<SearchBangumiParameters>(
  CATALOG_TOOL_SCHEMAS.search_bangumi,
);

/** `search_nearby`'s parameters. */
export const searchNearbyParameters = toolParameters<SearchNearbyParameters>(
  CATALOG_TOOL_SCHEMAS.search_nearby,
);

/** `plan_route`'s parameters. */
export const planRouteParameters = toolParameters<PlanRouteParameters>(
  CATALOG_TOOL_SCHEMAS.plan_route,
);
