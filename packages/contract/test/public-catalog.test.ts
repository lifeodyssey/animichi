/**
 * The public catalog surface's exact shape (#1691, from iter-5 S5.4).
 *
 * `PUBLIC_CATALOG_ROUTES` is the ONE declaration the edge gateway and the
 * catalog Worker's public middleware both read at runtime, so it is pinned
 * here against the contract those runtimes serve. The templates and the query
 * parameter names are derived from `catalogContract` itself — the same source
 * `apps/web`'s oRPC clients are built from — not restated as a second,
 * hand-maintained vocabulary that could drift from it.
 *
 * The query rule mirrors the client's own codec (`@orpc/openapi-client`
 * serializes a GET input into the query string after the path template's own
 * parameters are consumed), which is why an input key the template already
 * names is not a query parameter.
 *
 * test-type: unit.
 */
import { describe, expect, it } from "vitest";
import { catalogContract } from "../src/contract.js";
import {
  PUBLIC_CATALOG_PREFIX,
  PUBLIC_CATALOG_ROUTES,
  isPublicCatalogPath,
  unexpectedPublicCatalogQueryParam,
} from "../src/public-catalog.js";

/** The slice of an oRPC procedure's `~orpc` metadata this pin reads. */
interface ProcedureMetadata {
  readonly route: { readonly method: string; readonly path: string };
  readonly inputSchema?: { readonly shape?: Readonly<Record<string, unknown>> };
}

function metadata(procedure: unknown): ProcedureMetadata {
  return (procedure as { readonly "~orpc": ProcedureMetadata })["~orpc"];
}

/** The path template's own parameter names, in order. */
function pathParamNames(template: string): string[] {
  return [...template.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
}

/** The query parameters a GET serializes: the input's keys minus the ones the
 * path template consumes. */
function declaredQueryParams(procedure: unknown): string[] {
  const consumed = new Set(pathParamNames(metadata(procedure).route.path));
  return Object.keys(metadata(procedure).inputSchema?.shape ?? {}).filter((key) => !consumed.has(key));
}

/** Every public catalog route in the contract, as (template, query params). */
function contractPublicRoutes(): { template: string; queryParams: string[] }[] {
  return Object.values(catalogContract)
    .filter((procedure) => metadata(procedure).route.path.startsWith(PUBLIC_CATALOG_PREFIX))
    .map((procedure) => ({
      template: metadata(procedure).route.path,
      queryParams: declaredQueryParams(procedure),
    }));
}

/** A concrete path for a template: every `{param}` becomes a digit run. */
function concretePath(template: string): string {
  return template.replace(/\{[^}]+\}/g, "3302");
}

describe("the public catalog surface declaration", () => {
  it("is built from the contract's own public catalog routes (exact set)", () => {
    const declared = [...PUBLIC_CATALOG_ROUTES]
      .map((route) => `${route.template} [${route.queryParams.join(",")}]`)
      .sort();
    const derived = contractPublicRoutes()
      .map((route) => `${route.template} [${route.queryParams.join(",")}]`)
      .sort();
    expect(declared).toEqual(derived);
  });

  it("derives at least one route, so the comparison above cannot pass vacuously", () => {
    expect(contractPublicRoutes().length).toBeGreaterThan(0);
  });

  it("keeps every declared template under the one public prefix", () => {
    expect(PUBLIC_CATALOG_ROUTES.length).toBeGreaterThan(0);
    for (const route of PUBLIC_CATALOG_ROUTES) {
      expect(route.template.startsWith(PUBLIC_CATALOG_PREFIX)).toBe(true);
    }
  });

  it("declares the popularity ranking's bounded limit and no other query parameter", () => {
    const popular = PUBLIC_CATALOG_ROUTES.find((route) => route.template.endsWith("/popular"));
    expect(popular?.queryParams).toEqual(["limit"]);
  });
});

describe("the public catalog matcher", () => {
  it("matches every declared route's concrete path", () => {
    for (const route of PUBLIC_CATALOG_ROUTES) {
      expect(isPublicCatalogPath(concretePath(route.template))).toBe(true);
    }
  });

  it("matches nothing outside the declared templates", () => {
    expect(isPublicCatalogPath("/catalog/public")).toBe(false);
    expect(isPublicCatalogPath("/catalog/public/secret")).toBe(false);
    expect(isPublicCatalogPath("/catalog/public/anime-overviews/3302")).toBe(false);
    expect(isPublicCatalogPath("/catalog/search")).toBe(false);
  });

  it("keeps the numeric bangumi id and the encoded separator out of the surface", () => {
    // The id constraint mirrors `AnimeOverviewInput`'s own `^\d+$`: an encoded
    // separator must not extend the forward, which `entry.test.ts` pins too.
    expect(isPublicCatalogPath("/catalog/public/anime-overview/abc")).toBe(false);
    expect(isPublicCatalogPath("/catalog/public/anime-overview/3302%2Fsecret")).toBe(false);
  });
});

describe("undeclared public catalog query parameters", () => {
  it("accepts an empty query and every declared parameter", () => {
    expect(unexpectedPublicCatalogQueryParam("/catalog/public/popular", [])).toBeNull();
    expect(unexpectedPublicCatalogQueryParam("/catalog/public/popular", ["limit"])).toBeNull();
    expect(
      unexpectedPublicCatalogQueryParam("/catalog/public/anime-overview/3302", []),
    ).toBeNull();
  });

  it("names the first undeclared parameter", () => {
    expect(unexpectedPublicCatalogQueryParam("/catalog/public/popular", ["spoof"])).toBe("spoof");
    expect(unexpectedPublicCatalogQueryParam("/catalog/public/popular", ["limit", "spoof"])).toBe("spoof");
    expect(
      unexpectedPublicCatalogQueryParam("/catalog/public/anime-overview/3302", ["nonce"]),
    ).toBe("nonce");
  });

  it("rejects every parameter on a path no public route declares", () => {
    expect(unexpectedPublicCatalogQueryParam("/catalog/public/secret", ["nonce"])).toBe("nonce");
  });
});
