// TODO(#841 path-delta): test double — stays at the worker root because the
// root `test:worker` glob (`workers/edge/*.test.ts`) keeps tests flat; moves to
// protect/ alongside its tests in the #853 package-ization.
import { TURNSTILE_HEADER, type TurnstileGate, type TurnstileResult, createTurnstileGate, guardTurnstile } from "./protect/turnstile.ts";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const ENV = { TURNSTILE_SECRET: "test-secret-not-a-real-value" };
/** The anonymous identity the pass window is scoped to (issue #447). */
export const ID = "anon_0123456789abcdef0123456789abcdef";

export interface Call {
  readonly url: string;
  readonly contentType: string | null;
  readonly body: URLSearchParams;
}

/** A siteverify stub that records every call and answers with a fixed verdict. */
export function stubFetch(calls: Call[], success: boolean, errorCodes: string[] = []): typeof fetch {
  return (input, init) => {
    calls.push(recordCall(input, init));
    return Promise.resolve(Response.json({ success, "error-codes": errorCodes }));
  };
}

export interface GateCall {
  readonly token: string | null;
  readonly clientIp: string;
  readonly secret: string;
}

/** A gate that records every check and passes only the token it was told to. */
export function recordingGate(calls: GateCall[], solved: string | null): TurnstileGate {
  return {
    check: (token, clientIp, secret) => {
      calls.push({ token, clientIp, secret });
      const ok = solved !== null && token === solved;
      return Promise.resolve({ ok, errorCodes: ok ? [] : ["invalid-input-response"] });
    },
  };
}

function recordCall(input: RequestInfo | URL, init?: RequestInit): Call {
  const rawBody = init?.body;
  const bodyText = rawBody instanceof URLSearchParams ? rawBody.toString() : typeof rawBody === "string" ? rawBody : "";
  const body = new URLSearchParams(bodyText);
  const headers = new Headers(init?.headers);
  const inputUrl = input instanceof Request ? input.url : input.toString();
  return { url: inputUrl, contentType: headers.get("Content-Type"), body };
}

export function request(token?: string): Request {
  const headers = new Headers({ "CF-Connecting-IP": "203.0.113.7" });
  if (token !== undefined) headers.set(TURNSTILE_HEADER, token);
  return new Request("https://animichi.test/v1/chat", { method: "POST", headers });
}

/** Mocked clock: the window is measured against `now`, never real time. */
export function clockGate(clock: { ms: number }, calls: Call[]) {
  return createTurnstileGate({
    fetchImpl: stubFetch(calls, true),
    now: () => clock.ms,
    windowMs: 60_000,
  });
}

/** The composition S1.8 (#274) will mount: guard first, forward only on pass. */
export async function anonymousV1(
  req: Request,
  gate: ReturnType<typeof createTurnstileGate>,
  forward: () => Response,
): Promise<Response> {
  const denied = await guardTurnstile(req, ENV, gate, ID);
  return denied ?? forward();
}

/** Capture console.error while running an outage case. */
export async function withErrorLog(run: () => Promise<TurnstileResult | Response | null>) {
  const records: string[] = [];
  const original = console.error;
  console.error = (line: unknown) => { records.push(String(line)); };
  try {
    return { result: await run(), records };
  } finally {
    console.error = original;
  }
}

export const unreachable: typeof fetch = () => Promise.reject(new Error("network down"));
export const htmlGateway: typeof fetch = () =>
  Promise.resolve(new Response("<html>502</html>", { status: 502 }));
