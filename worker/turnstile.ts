/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Turnstile edge gate (S1.9 / issue #281).
 *
 * Verification is ALWAYS server-side: the browser only collects a token, the
 * Worker exchanges it at siteverify with the secret binding. The secret lives
 * in `env.TURNSTILE_SECRET` (a Worker secret binding) — there is no
 * `process.env` in Workers, so never reach for it here.
 */

/** Cloudflare's canonical server-side verification endpoint. */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Request header carrying the widget token (not a form field, not a body key). */
export const TURNSTILE_HEADER = "cf-turnstile-response";

/**
 * How long one successful verification keeps covering follow-up turns.
 * Turnstile tokens are single-use at siteverify (a replay returns
 * `timeout-or-duplicate`), so caching the pass is exactly what stops an
 * anonymous user from being re-challenged on every message.
 */
export const TURNSTILE_WINDOW_MS = 5 * 60_000;

export interface TurnstileResult {
  readonly ok: boolean;
  readonly errorCodes: readonly string[];
}

export interface TurnstileEnv {
  readonly TURNSTILE_SECRET: string;
}

export interface TurnstileGate {
  readonly check: (
    token: string | null,
    clientIp: string,
    secret: string,
  ) => Promise<TurnstileResult>;
}

const MISSING_TOKEN: TurnstileResult = { ok: false, errorCodes: ["missing-input-response"] };
const WINDOW_PASS: TurnstileResult = { ok: true, errorCodes: [] };
const BAD_RESPONSE: TurnstileResult = { ok: false, errorCodes: ["bad-siteverify-response"] };

function stringsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const items: readonly unknown[] = value;
  return items.filter((item): item is string => typeof item === "string");
}

/** Narrow the siteverify JSON at the trust boundary — never trust its shape. */
function readSiteverify(body: unknown): TurnstileResult {
  if (typeof body !== "object" || body === null) return BAD_RESPONSE;
  const record = body as Record<string, unknown>;
  return { ok: record.success === true, errorCodes: stringsOf(record["error-codes"]) };
}

/** The canonical siteverify call. Pure apart from the injected `fetchImpl`. */
export async function verifySiteverify(
  token: string,
  clientIp: string,
  secret: string,
  fetchImpl: typeof fetch,
): Promise<TurnstileResult> {
  const response = await fetchImpl(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, remoteip: clientIp }),
  });
  const body: unknown = await response.json();
  return readSiteverify(body);
}

export interface TurnstileGateOptions {
  readonly now?: () => number;
  readonly windowMs?: number;
  readonly verify?: typeof verifySiteverify;
  readonly fetchImpl?: typeof fetch;
}

interface GateState {
  readonly passed: Map<string, number>;
  readonly now: () => number;
  readonly windowMs: number;
  readonly verify: typeof verifySiteverify;
  readonly fetchImpl: typeof fetch;
}

function toState(options: TurnstileGateOptions): GateState {
  return {
    passed: new Map<string, number>(),
    now: options.now ?? (() => Date.now()),
    windowMs: options.windowMs ?? TURNSTILE_WINDOW_MS,
    verify: options.verify ?? verifySiteverify,
    fetchImpl: options.fetchImpl ?? ((input, init) => fetch(input, init)),
  };
}

/** True when this exact token already passed and its window is still open. */
function isWithinWindow(state: GateState, token: string): boolean {
  const expiresAt = state.passed.get(token);
  return expiresAt !== undefined && expiresAt > state.now();
}

/** Drop expired entries so the window map stays bounded. */
function prune(state: GateState): void {
  const now = state.now();
  for (const [token, expiresAt] of state.passed) {
    if (expiresAt <= now) state.passed.delete(token);
  }
}

async function checkToken(
  state: GateState,
  token: string | null,
  clientIp: string,
  secret: string,
): Promise<TurnstileResult> {
  if (token === null || token === "") return MISSING_TOKEN;
  if (isWithinWindow(state, token)) return WINDOW_PASS;
  prune(state);
  const result = await state.verify(token, clientIp, secret, state.fetchImpl);
  if (result.ok) state.passed.set(token, state.now() + state.windowMs);
  return result;
}

/** Build a gate with its own short-lived verification window. */
export function createTurnstileGate(options: TurnstileGateOptions = {}): TurnstileGate {
  const state = toState(options);
  return { check: (token, clientIp, secret) => checkToken(state, token, clientIp, secret) };
}

/**
 * The rejection envelope. `retryable` tells the client to re-render the widget
 * and resend rather than treating this as a dead end. Siteverify error codes
 * are deliberately NOT echoed — they would disclose edge configuration state.
 */
function rejection(): Response {
  return Response.json(
    { error: { code: "turnstile_required", message: "Turnstile verification required.", retryable: true } },
    { status: 403 },
  );
}

/**
 * Edge guard. Returns `null` when the caller may proceed to forward the
 * request, or a 403 Response the caller MUST return without ever touching the
 * container.
 */
export async function guardTurnstile(
  request: Request,
  env: TurnstileEnv,
  gate: TurnstileGate,
): Promise<Response | null> {
  const token = request.headers.get(TURNSTILE_HEADER);
  const clientIp = request.headers.get("CF-Connecting-IP") ?? "";
  const result = await gate.check(token, clientIp, env.TURNSTILE_SECRET);
  return result.ok ? null : rejection();
}
