import { afterEach, describe, expect, it, vi } from "vitest";
import { createUsersApp } from "../src/index";
import { identityHeaders, TEST_ENV } from "./identity-fixture";
import { fakeUsersPrisma } from "./fake-users-prisma";

/**
 * SUT: the users Worker's internal-identity boundary (`src/index.ts`) and the line a listed request
 * writes (`src/router.ts`). The gateway sends its request ID on `X-Request-Id` over the USERS
 * binding, the same channel as the verified identity it forwards; the line carries that ID as
 * `request_id=`, and a header value that is not the gateway's format is never written to it.
 */

/** A request ID as the gateway mints it: a lowercase UUID. */
const GATEWAY_ID = "6f1a4c2e-8f3b-4d5a-9c7e-2b1d0a4e5f60";

/** What one admitted list request writes to `console.info`. */
async function listLine(requestId: string): Promise<string> {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const { prisma } = fakeUsersPrisma();
  const headers = identityHeaders("user-a", { "X-Request-Id": requestId });
  const response = await createUsersApp({ makePrisma: () => prisma }).request("/v1/users/saved-routes", { headers }, TEST_ENV);
  expect(response.status).toBe(200);
  return info.mock.calls.map((call) => String(call[0])).join("\n");
}

afterEach(() => { vi.restoreAllMocks(); });

describe("the gateway's request ID on the users list line", () => {
  it("carries the ID the gateway forwarded", async () => {
    expect(await listLine(GATEWAY_ID)).toContain(`request_id=${GATEWAY_ID}`);
  });

  it.each([
    ["trailing text", `${GATEWAY_ID} injected=1`],
    ["leading text", `injected=1 ${GATEWAY_ID}`],
    ["upper case", GATEWAY_ID.toUpperCase()],
  ])("never writes a value with %s, which the gateway never mints", async (_shape, value) => {
    const line = await listLine(value);
    expect(line).toContain("request_id=-");
    expect(line).not.toContain(value);
  });
});
