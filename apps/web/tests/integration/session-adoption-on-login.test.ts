/**
 * @vitest-environment jsdom
 *
 * Issue #507 end-to-end: the adoption endpoint was finished, reachable and
 * unit-tested on both the edge and the container — and had never once been
 * called, because nothing wired the client half. Every part was green; the
 * chain was not.
 *
 * So this asserts the chain, not a seam. It renders the REAL `<AuthCallback>`
 * with no injected doubles at all — the production `getAuthToken`,
 * `replayDeferredSave` and `adoptSessions` defaults — and asserts on
 * the HTTP request an edge stand-in actually observed. Every collaborator
 * between the rendered component and the socket is the real one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallback } from "../../src/components/auth/AuthCallback";
import { LocaleProvider } from "../../src/i18n/LocaleProvider";
import { dictFor } from "../../src/i18n/dictionaries";

// The integration lane has no locale setup, so jsdom's `en-US` navigator wins.
const auth = dictFor("en").auth;
import { clearAuthToken } from "../../src/lib/auth/auth-session";
import { SESSION_ADOPT_PATH } from "../../src/lib/auth/session-adoption";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/lib/runtime-config/runtime-config";

const NEON_AUTH = "http://localhost:3000/neondb/auth";
const ADOPT_URL = "http://localhost:3000/v1/sessions/adopt";
const JWT = "eyJhbGciOiJFZERTQSJ9.integration.signature";

interface Observed {
  readonly method: string;
  readonly authorization: string | null;
  readonly credentials: string;
  readonly body: string;
  readonly contentLength: string | null;
}

const observed: Observed[] = [];

async function observeAdopt(request: Request): Promise<void> {
  observed.push({
    method: request.method,
    authorization: request.headers.get("authorization"),
    credentials: request.credentials,
    body: await request.text(),
    contentLength: request.headers.get("content-length"),
  });
}

/** Stand-in for the container behind the edge. Declarative fixtures, no branch
 * in the handler: the FIRST POST adopts one session (consumed once); every
 * later one matches zero rows and returns the typed no-op — the real
 * `UPDATE ... WHERE user_id = $from_anon` semantics. */
const adoptHandler = http.post(ADOPT_URL, async ({ request }) => {
  await observeAdopt(request);
  return HttpResponse.json({ adopted: 1, noop_class: "adopted" });
}, { once: true });
const adoptNoopHandler = http.post(ADOPT_URL, async ({ request }) => {
  await observeAdopt(request);
  return HttpResponse.json({ adopted: 0, noop_class: "no_rows" });
});

const server = setupServer(
  http.get(`${NEON_AUTH}/token`, () => HttpResponse.json({ token: JWT })),
  adoptHandler,
  adoptNoopHandler,
);

beforeAll(() => { server.listen({ onUnhandledRequest: "error" }); });
afterAll(() => { server.close(); });

beforeEach(() => {
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, neonAuthBaseUrl: NEON_AUTH });
  observed.length = 0;
  localStorage.clear();
  clearAuthToken();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.unstubAllGlobals();
});

/** The real component, the real hook, the real defaults — no injection. */
async function signIn(calls: number): Promise<void> {
  render(createElement(LocaleProvider, null, createElement(AuthCallback, { onDone: () => undefined })));
  await vi.waitFor(() => { expect(observed).toHaveLength(calls); });
}

describe("a login drives the session-adoption endpoint end to end", () => {
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

  it("surfaces a failed claim to the visitor instead of navigating past it", async () => {
    // #507 review P1-3: `apps/web` has no telemetry sink, so the visitor is the
    // only real outlet. A 503 must reach the DOM, not just a console line.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    server.use(http.post(ADOPT_URL, () => HttpResponse.json({}, { status: 503 })));
    let isDone = false;
    render(createElement(LocaleProvider, null,
      createElement(AuthCallback, { onDone: () => { isDone = true; } })));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(auth.callback_adoption_failed);
    expect(isDone).toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: "auth_session_adoption", anomaly: "failed" }),
    );
    warn.mockRestore();
  });

  it("still lets the visitor through — the login is never blocked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    server.use(http.post(ADOPT_URL, () => HttpResponse.json({}, { status: 503 })));
    let isDone = false;
    render(createElement(LocaleProvider, null,
      createElement(AuthCallback, { onDone: () => { isDone = true; } })));
    fireEvent.click(await screen.findByRole("button", { name: auth.callback_adoption_skip }));
    await vi.waitFor(() => { expect(isDone).toBe(true); });
  });
});

/**
 * The stand-in above proves the client half fires; this pins it to the same
 * string the live edge routes on. #507 was two finished halves that never met,
 * and a silent rename of either path would recreate it exactly.
 */
describe("the posted path is the one the edge routes on", () => {
  it("matches workers/edge/identity/session-adopt.ts's SESSION_ADOPT_PATH literal", () => {
    const edge = readFileSync(
      resolve(import.meta.dirname, "../../../../workers/edge/src/identity/session-adopt.ts"),
      "utf8",
    );
    expect(edge).toContain(`export const SESSION_ADOPT_PATH = "${SESSION_ADOPT_PATH}"`);
  });
});
