import { describe, expect, it } from "vitest";
import { THEME_BOOTSTRAP_SCRIPT } from "../../src/components/theme-bootstrap";
import { TURNSTILE_SCRIPT_SRC } from "../../src/features/chat/components/turnstile-sdk";
import { CF_WEB_ANALYTICS_SRC } from "../../src/features/seo/analytics";
import { SPLASH_SCRIPTING_MARK_SCRIPT } from "../../src/features/splash/splash-release";
import { CSP_NONCE_CONTEXT_KEY } from "../../src/server/csp-policy";
import { cspMiddleware } from "../../src/server/csp-middleware";
import { allowsInlineScript, sourceList } from "../csp-evaluator";

/**
 * These cases drive the real middleware through the framework's own contract:
 * `createStartHandler` reads `middleware.options.server` and calls it with
 * `{ request, pathname, context, next, handlerType }`, so nothing about the
 * policy is stubbed out here. The pair these cases are really about is the
 * nonce the middleware hands the render (captured off `next`) and the one it
 * writes into the header — "the header and the render agree" is exactly the
 * assertion that they are the same value.
 */

interface Served {
  readonly policy: string;
  readonly nonce: string | undefined;
  readonly status: number;
}

const HOME = new Request("http://web.test/");

function documentResponse(status: number): Response {
  return new Response("<html><body>doorway</body></html>", {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The middleware exactly as `createStartHandler` invokes it. `createMiddleware`
 * types its server function generically over the whole middleware chain, so
 * this states the slice the test drives instead of importing that generics
 * soup; the three fields the middleware reads are the real ones.
 */
type ServerMiddleware = (options: {
  request: Request;
  pathname: string;
  context: undefined;
  handlerType: "router";
  next: (options?: { context?: unknown }) => Promise<unknown>;
}) => Promise<unknown>;

async function served(status = 200): Promise<Served> {
  const server = cspMiddleware.options.server as unknown as ServerMiddleware;
  let nonce: string | undefined;
  const next = (options?: { context?: unknown }): Promise<unknown> => {
    const context = options?.context;
    nonce = isRecord(context) ? (context[CSP_NONCE_CONTEXT_KEY] as string | undefined) : undefined;
    return Promise.resolve({ request: HOME, pathname: "/", context: undefined, response: documentResponse(status) });
  };
  const result = (await server({ request: HOME, pathname: "/", context: undefined, handlerType: "router", next })) as {
    response: Response;
  };
  return { policy: result.response.headers.get("Content-Security-Policy") ?? "", nonce, status: result.response.status };
}

function nonceSource(policy: string): string | undefined {
  return sourceList(policy, "script-src").find((source) => source.startsWith("'nonce-"));
}

const ATTACK = "fetch('/steal?k='+sessionStorage.getItem('byok-api-key'))";
const APP_SCRIPTS = [THEME_BOOTSTRAP_SCRIPT, SPLASH_SCRIPTING_MARK_SCRIPT];

describe("the policy is served on the document response (AC1)", () => {
  it("writes Content-Security-Policy on the response the client gets", async () => {
    expect(nonceSource((await served()).policy)).toMatch(/^'nonce-[A-Za-z0-9_-]{22}'$/u);
  });

  it("advertises the very nonce it handed the render", async () => {
    const { policy, nonce } = await served();
    expect(nonce).toBeDefined();
    expect(nonceSource(policy)).toBe(`'nonce-${String(nonce)}'`);
  });

  it("mints a different nonce per response, so one leak is not a standing key", async () => {
    expect((await served()).nonce).not.toBe((await served()).nonce);
  });

  it("serves it on a 404 document too, not just on the happy path", async () => {
    // h3 v2 drops an event's prepared headers from a non-ok Response
    // (`prepareResponse`), which is why this sets the header on the Response
    // object itself: a rendered 404 is a document like any other, and the
    // branded one was shipping with no policy at all.
    const { policy, nonce, status } = await served(404);
    expect(status).toBe(404);
    expect(nonceSource(policy)).toBe(`'nonce-${String(nonce)}'`);
  });
});

describe("an inline script the app did not emit is refused (AC2)", () => {
  it("refuses it under the served policy", async () => {
    expect(allowsInlineScript((await served()).policy, { content: ATTACK })).toBe(false);
  });

  it("refuses it even when it guesses a nonce", async () => {
    expect(allowsInlineScript((await served()).policy, { nonce: "guessed-nonce-value", content: ATTACK })).toBe(false);
  });

  it("refuses one copy-pasted from the app's own scripts but stripped of the nonce", async () => {
    for (const content of APP_SCRIPTS) {
      expect(allowsInlineScript((await served()).policy, { content })).toBe(false);
    }
  });

  it("would let it through a decorative policy — so the refusal is the assertion", () => {
    const decorative = "default-src 'self'; script-src 'self' 'unsafe-inline'";
    expect(allowsInlineScript(decorative, { content: ATTACK })).toBe(true);
  });
});

describe("the app's own bootstrap still runs under the policy (AC3)", () => {
  it("allows each inline script the app emits, once it carries the served nonce", async () => {
    const { policy, nonce } = await served();
    for (const content of APP_SCRIPTS) {
      expect(allowsInlineScript(policy, { nonce, content })).toBe(true);
    }
  });

  it("keeps the response's own scripts and styles reachable", async () => {
    const { policy } = await served();
    expect(sourceList(policy, "script-src")).toContain("'self'");
    expect(sourceList(policy, "style-src")).toContain("'self'");
  });

  it("allows the Turnstile origin for both its script and its widget frame", async () => {
    const origin = new URL(TURNSTILE_SCRIPT_SRC).origin;
    const { policy } = await served();
    expect(sourceList(policy, "script-src")).toContain(origin);
    expect(sourceList(policy, "frame-src")).toContain(origin);
  });

  it("allows the Cloudflare Web Analytics beacon's script and reporting origins", async () => {
    const { policy } = await served();
    expect(sourceList(policy, "script-src")).toContain(new URL(CF_WEB_ANALYTICS_SRC).origin);
    expect(sourceList(policy, "connect-src")).toContain("https://cloudflareinsights.com");
  });
});
