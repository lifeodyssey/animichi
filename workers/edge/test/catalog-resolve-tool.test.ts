/**
 * W1-4 (#1253): `resolve_anime`'s outcome partition, ported from
 * `apps/agent/src/animichi/agents/catalog_tools.py::run_resolve`.
 *
 * The model-visible half is the outcome JSON; the session-visible half is the
 * pending clarification and the current anime. Both are asserted, because the
 * next turn reads the second one and no frame would reveal it.
 *
 * test-type: unit (no network, no clock, no bindings).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CatalogUnavailableError } from "../src/agent/tools/catalog-client.ts";
import type { CatalogClient } from "../src/agent/tools/catalog-client.ts";
import { resolveAnimeTool } from "../src/agent/tools/resolve-anime-tool.ts";
import { unspentBudget } from "./doubles/make-tool-budget.ts";
import { makeCatalogToolSession } from "./doubles/make-catalog-tool-session.ts";
import type { RecordingToolSession } from "./doubles/make-catalog-tool-session.ts";
import { scriptedCatalog } from "./doubles/scripted-catalog.ts";
import type { CatalogScript } from "./doubles/scripted-catalog.ts";

const LUCKY_STAR = { bangumi_id: "1", title: "らき☆すた", title_cn: "幸运星" };
const K_ON = { bangumi_id: "2", title: "K-On!", title_cn: "轻音少女" };

/** Run `resolve_anime` over a scripted catalog and report both halves. */
async function resolve(script: CatalogScript, title: string, session = makeCatalogToolSession()) {
  const { catalog } = scriptedCatalog(script);
  const result = await resolveAnimeTool(catalog, session, unspentBudget).execute("call-1", { title });
  return { outcome: result.details, text: result.content, session };
}

/** Run `resolve_anime` against a catalog that cannot answer at all. */
function resolveAgainstOutage(detail: string, session: RecordingToolSession) {
  const catalog = {
    resolve: () => Promise.reject(new CatalogUnavailableError(detail)),
  } as unknown as CatalogClient;
  return resolveAnimeTool(catalog, session, unspentBudget).execute("call-1", { title: "らき☆すた" });
}

void test("a single match resolves and becomes the session's current anime", async () => {
  const { outcome, session } = await resolve({ resolve: { outcome: "resolved", match: LUCKY_STAR } }, "らき☆すた");
  assert.deepEqual(outcome, { outcome: "resolved", bangumi_id: "1", anime_title: "らき☆すた" });
  assert.deepEqual(session.animes, [{ bangumiId: "1", title: "らき☆すた" }]);
  assert.deepEqual(session.clarifications, ["cleared"]);
});

void test("a match that is a different entry in the series is not found, not answered", async () => {
  const { outcome, session } = await resolve({ resolve: { outcome: "resolved", match: K_ON } }, "K-On! Movie");
  assert.deepEqual(outcome, { outcome: "not_found", clarification_reason: "anime_not_found" });
  assert.deepEqual(session.animes, []);
  assert.deepEqual(session.clarifications, [{ reason: "anime_not_found", candidates: [] }]);
});

void test("several matches become candidate ids and a pending choice", async () => {
  const { outcome, session } = await resolve(
    {
      resolve: {
        outcome: "needs_disambiguation",
        reason: "anime_ambiguity",
        candidates: [LUCKY_STAR, K_ON],
      },
    },
    "らき",
  );
  assert.deepEqual(outcome, {
    outcome: "needs_disambiguation",
    clarification_reason: "anime_ambiguity",
    candidate_ids: ["1", "2"],
  });
  assert.deepEqual(session.clarifications, [
    {
      reason: "anime_ambiguity",
      candidates: [
        { id: "1", title: "らき☆すた", cover_url: undefined, points_count: undefined },
        { id: "2", title: "K-On!", cover_url: undefined, points_count: undefined },
      ],
    },
  ]);
});

void test("no match asks for a corrected title", async () => {
  const { outcome, session } = await resolve(
    { resolve: { outcome: "not_found", reason: "anime_not_found" } },
    "ますますますます",
  );
  assert.deepEqual(outcome, { outcome: "not_found", clarification_reason: "anime_not_found" });
  assert.deepEqual(session.clarifications, [{ reason: "anime_not_found", candidates: [] }]);
});

void test("the catalog's own upstream failure clears the pending choice", async () => {
  const { outcome, session } = await resolve(
    { resolve: { outcome: "upstream_unavailable", provider: "bangumi" } },
    "らき☆すた",
  );
  assert.deepEqual(outcome, { outcome: "upstream_unavailable" });
  assert.deepEqual(session.clarifications, ["cleared"]);
});

void test("an unreachable catalog degrades without leaking the upstream text (SD-19)", async () => {
  const session = makeCatalogToolSession();
  const result = await resolveAgainstOutage("resolve: connect ECONNREFUSED 10.0.0.1:5432", session);
  assert.deepEqual(result.details, { outcome: "upstream_unavailable" });
  assert.deepEqual(result.content, [{ type: "text", text: '{"outcome":"upstream_unavailable"}' }]);
});

void test("a padded title reaches the catalog trimmed, as ResolveInput demands", async () => {
  const { catalog, calls } = scriptedCatalog({ resolve: { outcome: "resolved", match: LUCKY_STAR } });
  await resolveAnimeTool(catalog, makeCatalogToolSession(), unspentBudget).execute("call-1", {
    title: "  らき☆すた\n",
  });
  assert.deepEqual(calls.resolved, ["らき☆すた"]);
});
