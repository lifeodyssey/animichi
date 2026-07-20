/**
 * @vitest-environment jsdom
 */
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../msw/node";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn() }));
vi.mock("../../../src/lib/auth/authSession", () => ({ authHeaders }));

import { users } from "../../../src/api/orpc";

afterEach(() => {
  authHeaders.mockReset();
});

/**
 * `users()` is the shared authenticated transport for the oRPC users
 * service: every request should carry the current session's bearer token
 * (or none, anonymously) without call sites having to thread it through.
 */
describe("users() authenticated transport", () => {
  it("sends no Authorization header when signed out", async () => {
    authHeaders.mockResolvedValue({});
    let seen: string | null = "unset";
    server.use(
      http.get("*/v1/users/routes", ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json({ routes: [] });
      }),
    );
    await users().listRoutes.call({});
    expect(seen).toBeNull();
  });

  it("injects the Bearer token when signed in", async () => {
    authHeaders.mockResolvedValue({ Authorization: "Bearer jwt-users" });
    let seen: string | null = "unset";
    server.use(
      http.get("*/v1/users/routes", ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json({ routes: [] });
      }),
    );
    await users().listRoutes.call({});
    expect(seen).toBe("Bearer jwt-users");
  });
});
