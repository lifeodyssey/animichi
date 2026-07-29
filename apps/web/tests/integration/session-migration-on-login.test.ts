/**
 * @vitest-environment jsdom
 *
 * Issue #507 end-to-end: the migration endpoint was finished, reachable and
 * unit-tested on both the edge and the container — and had never once been
 * called, because nothing wired the client half. Every part was green; the
 * chain was not.
 *
 * So this asserts the chain, not a seam. It renders the REAL `<AuthCallback>`
 * with no injected doubles at all — the production `getAuthToken`,
 * `replayDeferredSave` and `migrateAnonymousSession` defaults — and asserts on
 * the HTTP request an edge stand-in actually observed. Every collaborator
 * between the rendered component and the socket is the real one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallback } from "../../src/components/auth/AuthCallback";
import { LocaleProvider } from "../../src/i18n/context";
import { clearAuthToken } from "../../src/lib/auth/authSession";
import { SESSION_MIGRATE_PATH } from "../../src/lib/auth/sessionMigration";

const NEON_AUTH = "http://localhost:3000/neondb/auth";
const MIGRATE_URL = "http://localhost:3000/v1/session/migrate";
const JWT = "eyJhbGciOiJFZERTQSJ9.integration.signature";

interface Observed {
  readonly method: string;
  readonly authorization: string | null;
  readonly credentials: string;
  readonly body: string;
  readonly contentLength: string | null;
}

const observed: Observed[] = [];
/** Stand-in for the container behind the edge: the first call migrates, every
 * later one matches zero rows and returns the typed no-op — the real
 * `UPDATE ... WHERE user_id = $from_anon` semantics. */
const migrateHandler = http.post(MIGRATE_URL, async ({ request }) => {
  observed.push({
    method: request.method,
    authorization: request.headers.get("authorization"),
    credentials: request.credentials,
    body: await request.text(),
    contentLength: request.headers.get("content-length"),
  });
  return HttpResponse.json({ migrated: observed.length === 1 });
});

const server = setupServer(
  http.get(`${NEON_AUTH}/token`, () => HttpResponse.json({ token: JWT })),
  migrateHandler,
);

beforeAll(() => { server.listen({ onUnhandledRequest: "error" }); });
afterAll(() => { server.close(); });

beforeEach(() => {
  vi.stubEnv("VITE_NEON_AUTH_BASE_URL", NEON_AUTH);
  observed.length = 0;
  localStorage.clear();
  clearAuthToken();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.unstubAllEnvs();
});

/** The real component, the real hook, the real defaults — no injection. */
async function signIn(calls: number): Promise<void> {
  render(createElement(LocaleProvider, null, createElement(AuthCallback, { onDone: () => undefined })));
  await vi.waitFor(() => { expect(observed).toHaveLength(calls); });
}

describe("a login drives the session-migration endpoint end to end", () => {
  it("issues exactly one POST, carrying the established bearer and the cookie jar", async () => {
    await signIn(1);
    expect(observed[0]?.method).toBe("POST");
    expect(observed[0]?.authorization).toBe(`Bearer ${JWT}`);
    expect(observed[0]?.credentials).toBe("include");
  });

  it("sends no body: the endpoint is identity-dimensional and takes no session id", async () => {
    await signIn(1);
    expect(observed[0]?.body).toBe("");
    expect(observed[0]?.contentLength).toBeNull();
  });

  it("is idempotent across a repeated magic-link tap: the second run is a no-op", async () => {
    await signIn(1);
    cleanup();
    await signIn(2);
    expect(observed[1]?.authorization).toBe(`Bearer ${JWT}`);
  });

  it("keeps the login intact when the migration endpoint is down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    server.use(http.post(MIGRATE_URL, () => HttpResponse.json({}, { status: 503 })));
    let done = false;
    render(createElement(LocaleProvider, null,
      createElement(AuthCallback, { onDone: () => { done = true; } })));
    await vi.waitFor(() => { expect(done).toBe(true); });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: "auth_session_migration_failed" }),
    );
    warn.mockRestore();
  });
});

/**
 * The stand-in above proves the client half fires; this pins it to the same
 * string the live edge routes on. #507 was two finished halves that never met,
 * and a silent rename of either path would recreate it exactly.
 */
describe("the posted path is the one the edge routes on", () => {
  it("matches worker/app.ts's SESSION_MIGRATE_PATH literal", () => {
    const edge = readFileSync(resolve(import.meta.dirname, "../../../../worker/app.ts"), "utf8");
    expect(edge).toContain(`const SESSION_MIGRATE_PATH = "${SESSION_MIGRATE_PATH}"`);
  });
});
