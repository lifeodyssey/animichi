import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { describe, expect, it } from "vitest";
import { catalogRouter, type CatalogContext } from "../src/router";
import { fakeCatalogPrisma, unreachableCatalogPrisma } from "./fakes/fake-catalog-prisma";
import type { UpstreamUnavailableData } from "../src/lib/errors";

const handler = new OpenAPIHandler(catalogRouter);

async function call(body: unknown, context: CatalogContext): Promise<Response> {
  const { matched, response } = await handleRequest(body, context);
  expect(matched).toBe(true);
  if (!response) throw new Error("expected OpenAPI handler response");
  return response;
}

async function handleRequest(body: unknown, context: CatalogContext) {
  const request = new Request("https://catalog.test/catalog/points-by-bangumi-id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return handler.handle(request, { context });
}

/** A context whose READ answers on the plane (#1631). The ingest's own claim
 * read finds no parked job, so the route's uncovered-work path runs end to
 * end. */
function context(responses: unknown[][], fetchImpl?: typeof fetch): CatalogContext {
  return { prisma: fakeCatalogPrisma(...responses), fetchImpl };
}

function unreachableContext(): CatalogContext {
  return { prisma: unreachableCatalogPrisma() };
}

describe("work-id contract on the OpenAPI wire", () => {
  it("rejects a nonnumeric work id before SQL or upstream access", async () => {
    const response = await call({ bangumi_id: "not-a-number" }, unreachableContext());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ defined: false, status: 400 });
  });

  it("serializes UPSTREAM_UNAVAILABLE for a preview outage", async () => {
    const fetchImpl = (() => Promise.reject(new Error("anitabi down"))) as unknown as typeof fetch;
    const response = await call({ bangumi_id: "3302" }, context([[]], fetchImpl));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      defined: true, code: "UPSTREAM_UNAVAILABLE", status: 502,
      message: "Upstream catalog source unavailable",
      data: { upstream: "anitabi" } satisfies UpstreamUnavailableData,
    });
  });
});
