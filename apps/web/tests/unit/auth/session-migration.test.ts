/**
 * @vitest-environment jsdom
 */
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../msw/node";
import {
  SESSION_MIGRATE_PATH,
  migrateAnonymousSession,
  reportMigrationFailure,
} from "../../../src/lib/auth/sessionMigration";

const BASE = "http://edge.test";
const URL = `${BASE}${SESSION_MIGRATE_PATH}`;

interface Seen {
  method: string;
  authorization: string | null;
  credentials: string;
  body: string;
}

function capture(sink: Seen[], status = 200) {
  return http.post(URL, async ({ request }) => {
    sink.push({
      method: request.method,
      authorization: request.headers.get("authorization"),
      credentials: request.credentials,
      body: await request.text(),
    });
    return HttpResponse.json({ migrated: status === 200 }, { status });
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe("migrateAnonymousSession", () => {
  it("POSTs the bearer token to /v1/session/migrate with no body at all", async () => {
    const seen: Seen[] = [];
    server.use(capture(seen));
    expect(await migrateAnonymousSession("jwt-1", BASE)).toBe("ok");
    expect(seen).toEqual([
      { method: "POST", authorization: "Bearer jwt-1", credentials: "include", body: "" },
    ]);
  });

  it("sends credentials so the HttpOnly `aid` cookie can reach the edge", async () => {
    const seen: Seen[] = [];
    server.use(capture(seen));
    await migrateAnonymousSession("jwt-1", BASE);
    // The client cannot name the anonymous identity: `aid` is HttpOnly. Losing
    // this option would migrate nothing while still returning 200.
    expect(seen[0]?.credentials).toBe("include");
  });

  it("reports `ok` for the typed no-op, which is a success and not a failure", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ migrated: false })));
    expect(await migrateAnonymousSession("jwt-1", BASE)).toBe("ok");
  });

  it("reports `failed` on a non-2xx (a 403 from the reject-anonymous predicate)", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ error: "forbidden" }, { status: 403 })));
    expect(await migrateAnonymousSession("jwt-1", BASE)).toBe("failed");
  });

  it("reports `failed` rather than throwing when the request never lands", async () => {
    server.use(http.post(URL, () => HttpResponse.error()));
    await expect(migrateAnonymousSession("jwt-1", BASE)).resolves.toBe("failed");
  });

  it("is safe to repeat: the second call is issued and the server no-ops it", async () => {
    const seen: Seen[] = [];
    server.use(http.post(URL, async ({ request }) => {
      await request.text();
      return HttpResponse.json({ migrated: seen.push({} as Seen) === 1 });
    }));
    expect(await migrateAnonymousSession("jwt-1", BASE)).toBe("ok");
    expect(await migrateAnonymousSession("jwt-1", BASE)).toBe("ok");
    expect(seen).toHaveLength(2);
  });
});

describe("reportMigrationFailure", () => {
  it("emits one structured, credential-free event record", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportMigrationFailure();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: "auth_session_migration_failed" }),
    );
  });
});
