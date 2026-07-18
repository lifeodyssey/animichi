import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contractJsonHandler, orpcErrorResponse } from "../../msw/contract-handler";
import { server } from "../../msw/node";

const URL_ = "https://svc.test/echo";
const Input = z.object({ n: z.number() });
const Output = z.object({ doubled: z.number() });

function post(body: unknown): Promise<Response> {
  return fetch(URL_, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

describe("contractJsonHandler", () => {
  it("parses the request and the response against the contract schemas", async () => {
    server.use(contractJsonHandler({ method: "post", url: URL_, input: Input, output: Output, resolve: (i) => ({ doubled: i.n * 2 }) }));
    const response = await post({ n: 3 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ doubled: 6 });
  });

  it("rejects an illegal request with a typed BAD_REQUEST error", async () => {
    server.use(contractJsonHandler({ method: "post", url: URL_, input: Input, output: Output, resolve: (i) => ({ doubled: i.n }) }));
    const response = await post({ n: "not-a-number" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ defined: true, code: "BAD_REQUEST", status: 400 });
  });

  it("fails the response when a fixture is malformed", async () => {
    const badOutput = z.object({ doubled: z.number() });
    server.use(
      contractJsonHandler({ method: "post", url: URL_, input: Input, output: badOutput, resolve: () => ({ doubled: "x" } as unknown as { doubled: number }) }),
    );
    const response = await post({ n: 3 });
    expect(response.status).toBe(500);
  });

  it("emits an oRPC error envelope the client link can decode", () => {
    const response = orpcErrorResponse({ code: "WORK_NOT_FOUND", status: 404, message: "no points", data: { bangumi_id: "1" } });
    expect(response.status).toBe(404);
  });
});
