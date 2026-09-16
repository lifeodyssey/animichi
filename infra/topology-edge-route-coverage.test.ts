/** Every path `apps/web` resolves through the edge vs the zone route table (#1691).
 *
 * The defect this closes: `apps/web` resolves the catalog through the edge
 * origin (`apps/web/src/api/config.ts`, same-origin by design, #550), the edge
 * gateway serves `/catalog/public/*` (iter-5 S5.4, `docs/ops/deployment.md`),
 * and the zone route table declared neither — so the apex answered the catalog
 * path with the web Worker's 404 while every suite stayed green, because
 * `apps/web` mocks the path in MSW and the edge tests call the Worker object
 * directly. Nothing asked the deployed origin's own question.
 *
 * This test asks it against what Pulumi would actually send: the
 * `WorkersRoute` inputs, and the paths the web app resolves, derived from the
 * SAME declarations the edge reads at runtime —
 *
 *   - `AGENT_PATHS`            — the chat/photo-search/conversation surface,
 *   - `USERS_BINDING_PREFIX`   — the users surface,
 *   - `PUBLIC_CATALOG_ROUTES`  — the public catalog surface, itself pinned to
 *                                `catalogContract` (what `apps/web` builds its
 *                                oRPC catalog client from) by
 *                                `packages/contract/test/public-catalog.test.ts`.
 *
 * The private catalog procedures (`POST /catalog/search`, `/catalog/itinerary`,
 * …) are deliberately NOT in that set: they have no public door (iter-5 S5.4's
 * security AC) and are reachable only over the container's CATALOG binding, so
 * they are not paths the edge can route. A web call to one is a different
 * defect class, not a route-table gap.
 *
 * `PUBLIC_CATALOG_ROUTES` is imported by repository-relative path, not as a
 * package: `infra` is sealed into the CD release on its own
 * (`.github/scripts/release/seal-foundation.sh` archives `infra` alone), so the
 * Pulumi program may not take a workspace dependency. The module is
 * import-free, which is what makes the direct import safe.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_PATHS } from "../packages/contract/src/agent-paths.ts";
import { USERS_BINDING_PREFIX } from "../packages/contract/src/internal-binding.ts";
import { PUBLIC_CATALOG_PREFIX, PUBLIC_CATALOG_ROUTES } from "../packages/contract/src/public-catalog.ts";
import { buildStack, ofType, type Built } from "./testing/harness.ts";

const built: Built[] = await buildStack("prod", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  webDomain: "animichi.com",
  wwwDomain: "www.animichi.com",
});

const ROUTE = "cloudflare:index/workersRoute:WorkersRoute";
const APEX = "animichi.com";

/** A concrete path for a contract template: every `{param}` becomes a digit run. */
function concretePath(template: string): string {
  return template.replace(/\{[^}]+\}/g, "3302");
}

/** The paths the web app can resolve through the edge, one source per surface. */
function webResolvedPaths(): string[] {
  return [
    ...AGENT_PATHS.map((entry) => concretePath(entry.path)),
    USERS_BINDING_PREFIX,
    ...PUBLIC_CATALOG_ROUTES.map((route) => concretePath(route.template)),
  ];
}

function routePatterns(): string[] {
  return ofType(built, ROUTE).map((route) => String(route.inputs.pattern));
}

/** Cloudflare route patterns are literal except for `*`, which matches the
 * rest of the path. */
function patternCovers(pattern: string, path: string): boolean {
  const star = pattern.indexOf("*");
  return star === -1 ? pattern === path : path.startsWith(pattern.slice(0, star));
}

void test("every path the web app resolves through the edge is declared on the zone route table", () => {
  const patterns = routePatterns();
  assert.ok(patterns.length > 0, "the prod stack must declare its edge routes");
  const paths = webResolvedPaths();
  assert.ok(paths.length > 0, "the derived web path set must not be empty");
  for (const path of paths) {
    const covering = patterns.filter((pattern) => patternCovers(pattern, `${APEX}${path}`));
    assert.ok(
      covering.length > 0,
      `${path} is resolved through the edge but no route declares it; declared: ${patterns.join(", ")}`,
    );
  }
});

void test("the route table declares the one public catalog prefix", () => {
  const patterns = routePatterns();
  assert.equal(
    patterns.includes(`${APEX}${PUBLIC_CATALOG_PREFIX}*`),
    true,
    `the public catalog prefix must be routed to the edge; declared: ${patterns.join(", ")}`,
  );
});

/** One operation in a committed OpenAPI document, narrowed from JSON. */
interface DocumentOperation {
  readonly parameters?: readonly { readonly name?: unknown; readonly in?: unknown }[];
}

/** Every operation in a committed contract document that declares query parameters. */
function documentedQueryParams(filename: string): { path: string; queryParams: string[] }[] {
  const source = readFileSync(new URL(`../packages/contract/${filename}`, import.meta.url), "utf8");
  const document = JSON.parse(source) as { paths?: Record<string, Record<string, DocumentOperation>> };
  const found: { path: string; queryParams: string[] }[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const operation of Object.values(item)) {
      const queryParams = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === "query")
        .map((parameter) => String(parameter.name));
      if (queryParams.length > 0) found.push({ path, queryParams });
    }
  }
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

void test("every query parameter the contract declares on the public catalog surface is accepted by both runtimes", () => {
  // `openapi.json` is the committed declaration `apps/web`'s client serializes
  // from, pinned to `catalogContract` by the contract package's drift gate; the
  // module is the ONE allowlist the edge gateway and the catalog Worker read, so
  // an equality here means a parameter the web sends is a parameter both
  // runtimes accept, and an undeclared one stays rejected (#1691).
  const documented = documentedQueryParams("openapi.json").filter((operation) =>
    operation.path.startsWith(PUBLIC_CATALOG_PREFIX),
  );
  const declared = PUBLIC_CATALOG_ROUTES.filter((route) => route.queryParams.length > 0)
    .map((route) => ({ path: route.template, queryParams: [...route.queryParams] }))
    .sort((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(documented, declared);
});
