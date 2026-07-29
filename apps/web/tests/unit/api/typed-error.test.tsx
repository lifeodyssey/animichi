/**
 * @vitest-environment jsdom
 */
import { ORPCError, isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { createCatalogClient } from "../../../src/api/clients";
import { resolveApiConfig } from "../../../src/api/config";
import { server } from "../../msw/node";
import { catalogUpstreamErrorHandler } from "../../msw/handlers";
import { TEST_ORIGIN } from "../../msw/fixtures";

type CatalogClient = ReturnType<typeof createCatalogClient>;

async function searchError(client: CatalogClient): Promise<ORPCError<string, unknown>> {
  const { error } = await safe(client.search({ query: "hakone" }));
  return error as ORPCError<string, unknown>;
}

describe("typed error parity across SSR and client navigation", () => {
  it("decodes the same typed oRPC error on both paths", async () => {
    server.use(catalogUpstreamErrorHandler);
    // SSR resolves origin from env (no window); the client reads location.origin.
    const ssr = createCatalogClient({ url: resolveApiConfig({ VITE_SITE_ORIGIN: TEST_ORIGIN }).catalogUrl });
    const browser = createCatalogClient({ url: resolveApiConfig({}, window.location).catalogUrl });

    const ssrError = await searchError(ssr);
    const clientError = await searchError(browser);

    expect(ssrError).toBeInstanceOf(ORPCError);
    expect(clientError).toBeInstanceOf(ORPCError);
    expect(isDefinedError(ssrError)).toBe(true);
    expect(ssrError.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(ssrError.data).toEqual({ upstream: "anitabi" });
    expect(clientError.code).toBe(ssrError.code);
    expect(clientError.data).toEqual(ssrError.data);
  });
});
