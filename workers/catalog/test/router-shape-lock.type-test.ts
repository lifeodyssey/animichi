/**
 * Compile-time shape lock for the contract-first router implementation.
 * This file is included by tsconfig but not Vitest's runtime test glob.
 */
import {
  catalogContract,
  type AnimeOverview,
  type ResolveOutcome,
  type SearchResult,
} from "@seichijunrei/contract";
import { implement } from "@orpc/server";
import { expectTypeOf } from "vitest";
import type { CatalogContext } from "../src/router";

const os = implement(catalogContract).$context<CatalogContext>();
const validOutput: SearchResult = { rows: [], synced_at: "2026-07-13T00:00:00.000Z" };

expectTypeOf(validOutput).toExtend<SearchResult>();
os.search.handler(() => validOutput);
os.pointsByWorkId.handler(() => validOutput);
const resolved: ResolveOutcome = {
  outcome: "resolved",
  match: { bangumi_id: "3302", title: "らき☆すた" },
};
os.resolve.handler(() => resolved);

const overview: AnimeOverview = {
  bangumi_id: "3302",
  points_length: 0,
  circles: [],
  scenes: [],
  sample_routes: [],
};
os.animeOverview.handler(() => overview);

// @ts-expect-error -- the contract requires synced_at; removing this directive must fail tsc.
os.search.handler(() => ({ rows: [] }));
