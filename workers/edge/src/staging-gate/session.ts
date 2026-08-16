/**
 * #1054 — staging-gate session store (CI channel of the staging gate).
 *
 * A valid OIDC exchange authorizes the private smoke path by minting a
 * short-lived, opaque gate session (a random nonce, not a stored secret):
 * the session id is the value the CI smoke presents, and the store is the
 * source of truth it is checked against. Zero signing keys — the store's
 * strongly-consistent key/value surface is the authority, mirroring the
 * edge's EdgeGuard DO pattern (src/protect/guard-store.ts).
 *
 * The store is a persistence seam exactly like GuardStore: an interface so
 * the exchange/authorization logic stays pure and unit-testable against an
 * in-memory double with an injected clock, while production binds it to a
 * Durable Object (see src/protect/edge-guard.ts).
 */

/** A minted staging-gate session. */
export interface GateSession {
  /** The opaque value the CI smoke presents (header/cookie). */
  id: string;
  /** Unix ms at which the session expires (no longer authorizes any path). */
  expiresAtMs: number;
}

/** The strongly-consistent key/value surface the sessions live in. */
export interface GateSessionStore {
  get(id: string): Promise<unknown>;
  put(id: string, value: unknown): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Constant, production-grade exchange-session lifetime (CI smokes only). */
export const GATE_SESSION_TTL_MS = 15 * 60 * 1000;

/** Header the CI smoke presents the session id in (past the WAF exchange path). */
export const STAGING_GATE_SESSION_HEADER = "x-staging-session";

/** The exchange's URL path — passed through by the staging WAF gate (infra). */
export const STAGING_GATE_EXCHANGE_PATH = "/staging-gate/exchange";

/** An in-memory store for unit tests; isolates per-call state. */
export function memoryGateSessionStore(): GateSessionStore {
  const map = new Map<string, unknown>();
  return {
    get: (id) => Promise.resolve(map.get(id)),
    put: (id, value) => {
      map.set(id, value);
      return Promise.resolve();
    },
    delete: (id) => {
      map.delete(id);
      return Promise.resolve();
    },
  };
}

/** 256 bits of CSPRNG — enough entropy that guessing a live session is infeasible. */
export function newSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Mint a session with its fixed lifetime, clock-injected for tests. */
export function createGateSession(nowMs: number, id = newSessionId()): GateSession {
  return { id, expiresAtMs: nowMs + GATE_SESSION_TTL_MS };
}

/** True iff the stored value is an unexpired session issued by the exchange. */
export function isValidGateSession(value: unknown, nowMs: number): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { expiresAtMs?: unknown };
  return (
    typeof record.expiresAtMs === "number" &&
    Number.isFinite(record.expiresAtMs) &&
    record.expiresAtMs > nowMs
  );
}
