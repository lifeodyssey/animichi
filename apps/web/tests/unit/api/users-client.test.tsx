/**
 * @vitest-environment jsdom
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { users } from "../../../src/api/orpc";
import { createUsersClient } from "../../../src/api/clients";
import { server } from "../../msw/node";
import { TEST_ORIGIN } from "../../msw/fixtures";

const SAVED_ROUTES_URL = `${TEST_ORIGIN}/v1/users/saved-routes`;

describe("users client", () => {
  it("lists routes through the lazy users utils singleton", async () => {
    server.use(http.get(SAVED_ROUTES_URL, () => HttpResponse.json({ saved_routes: [] })));
    const result = await users().listSavedRoutes.call();
    expect(result.saved_routes).toEqual([]);
  });

  it("forwards the auth header on users requests", async () => {
    let seen: string | null = null;
    server.use(
      http.get(SAVED_ROUTES_URL, ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json({ saved_routes: [] });
      }),
    );
    const client = createUsersClient({ url: TEST_ORIGIN });
    await client.listSavedRoutes(undefined, { context: { headers: { authorization: "Bearer u" } } });
    expect(seen).toBe("Bearer u");
  });
});
