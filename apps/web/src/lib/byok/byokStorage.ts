/**
 * Session-scoped BYOK credential storage (issue #284 Task 6, X10).
 *
 * `sessionStorage` only — never `localStorage`. This bounds the credential to
 * the current browser session; it is not a hard per-tab boundary (a
 * duplicated tab or a restored session can carry `sessionStorage` along, per
 * the browser's own semantics — see threat T11), but it drops the key far
 * sooner than `localStorage` would. This module is the **only** place
 * allowed to touch `sessionStorage` for BYOK; a repo-wide grep test enforces
 * that no component calls it directly. SSR-safe: no `window` access at
 * import time, and every accessor checks availability first and degrades to
 * "no credential" rather than throwing.
 *
 * Every storage access is wrapped in `try`/`catch`, not just guarded by a
 * `typeof` check: **reading `window.sessionStorage` itself can throw** —
 * Safari (and other browsers' partitioned/blocked storage modes) implement
 * it as an accessor that raises a `SecurityError` on access, not merely on
 * `.getItem`/`.setItem`. Without the `try`/`catch` here, that exception would
 * propagate out of `byokHeaders()` and fail every chat turn for a user who
 * has never touched BYOK at all.
 *
 * Naming note: the spec prose refers to the read accessor as
 * "readByokConfig" — this module exports it as `getByokConfig`, matching the
 * `getX`/`setX`/`clearX` naming already used by `tokenStore.ts`/`authSession.ts`.
 */

/** The three model families the credential boundary (Task 3) accepts. */
export type ByokProvider = "openai-compatible" | "anthropic" | "gemini";

export interface ByokConfig {
  readonly provider: ByokProvider;
  readonly apiKey: string;
  readonly model: string;
  /** openai-compatible only. */
  readonly baseUrl?: string;
}

export type ByokSaveError = "model_required" | "key_required" | "key_invalid";
export type ByokSaveResult = { readonly ok: true } | { readonly ok: false; readonly error: ByokSaveError };

const CONFIG_KEY = "animichi.byok.config";
const VISION_KEY = "animichi.byok.vision";

/** Named default models (OQ-1): pre-filled by the settings panel and
 * user-overridable. Only the openai-compatible family has no sane default,
 * since it has no fixed catalog of model names. */
export const BYOK_DEFAULT_MODEL: Readonly<Record<"anthropic" | "gemini", string>> = {
  anthropic: "claude-sonnet-4-5",
  gemini: "gemini-2.5-flash",
};

/** `undefined` if `window` doesn't exist (SSR) or reading the accessor threw
 * (partitioned/blocked storage) — never lets either failure mode escape. */
function trySessionStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function isByokProvider(value: unknown): value is ByokProvider {
  return value === "openai-compatible" || value === "anthropic" || value === "gemini";
}

function isByokConfig(value: unknown): value is ByokConfig {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isByokProvider(record.provider) &&
    typeof record.apiKey === "string" &&
    typeof record.model === "string" &&
    (record.baseUrl === undefined || typeof record.baseUrl === "string")
  );
}

function safeGet(key: string): string | null {
  const storage = trySessionStorage();
  if (storage === undefined) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  const storage = trySessionStorage();
  if (storage === undefined) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Storage unavailable, partitioned, or over quota — degrade silently;
    // the credential simply won't be there on the next read.
  }
}

function safeRemove(key: string): void {
  const storage = trySessionStorage();
  if (storage === undefined) return;
  try {
    storage.removeItem(key);
  } catch {
    // Same rationale as safeSet.
  }
}

function parseConfig(raw: string | null): ByokConfig | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isByokConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `null` when absent, during SSR, storage is blocked, or the stored value
 * is corrupt/non-JSON. */
export function getByokConfig(): ByokConfig | null {
  return parseConfig(safeGet(CONFIG_KEY));
}

/** Printable ASCII only. Rejects both the `\r`/`\n` that make `Headers()`
 * throw a `TypeError` on the value, and non-Latin-1 characters that `fetch`
 * would otherwise reject deep inside the transport — either would otherwise
 * turn into an opaque, per-turn-sticky crash instead of a validation
 * rejection surfaced once at save time. */
const HEADER_SAFE = /^[\x20-\x7E]+$/u;

function keyMissing(config: ByokConfig): boolean {
  return config.apiKey.trim() === "";
}

function keyInvalid(config: ByokConfig): boolean {
  return !HEADER_SAFE.test(config.apiKey);
}

function modelInvalid(config: ByokConfig): boolean {
  const required = config.provider === "openai-compatible";
  if (!required) return false;
  return config.model.trim() === "" || !HEADER_SAFE.test(config.model);
}

/** Pure validation the settings panel can call before (and instead of)
 * attempting a save, to render its inline message synchronously. */
export function validateByokConfig(config: ByokConfig): ByokSaveResult {
  if (keyMissing(config)) return { ok: false, error: "key_required" };
  if (keyInvalid(config)) return { ok: false, error: "key_invalid" };
  if (modelInvalid(config)) return { ok: false, error: "model_required" };
  return { ok: true };
}

/**
 * Persists the config and clears any vision flag left over from a prior
 * credential — a new key's vision support is unknown until it is re-probed.
 * A no-op during SSR or if storage is unavailable. Rejects (without
 * writing) when validation fails.
 */
export function saveByokConfig(config: ByokConfig): ByokSaveResult {
  const result = validateByokConfig(config);
  if (!result.ok) return result;
  safeSet(CONFIG_KEY, JSON.stringify(config));
  safeRemove(VISION_KEY);
  return result;
}

/** Drops the credential and its vision flag together — never one without
 * the other, so a stale vision badge can never outlive its key. */
export function clearByokConfig(): void {
  safeRemove(CONFIG_KEY);
  safeRemove(VISION_KEY);
}

/** Records the outcome of a `/v1/byok/probe` call (Task 5) against the
 * currently saved credential. A no-op with no config saved — otherwise a
 * probe that resolves after the credential was cleared (or before one was
 * ever saved) would leave an orphaned vision flag with nothing to attach to,
 * which a subsequently-saved unrelated credential could then inherit. */
export function setByokVisionSupported(supported: boolean): void {
  if (getByokConfig() === null) return;
  safeSet(VISION_KEY, supported ? "true" : "false");
}

/** `null` when no probe has run yet for the current credential. */
export function getByokVisionSupported(): boolean | null {
  const raw = safeGet(VISION_KEY);
  return raw === null ? null : raw === "true";
}

function baseUrlHeader(config: ByokConfig): Record<string, string> {
  const { provider, baseUrl } = config;
  if (provider !== "openai-compatible" || baseUrl === undefined || baseUrl.trim() === "") return {};
  return { "X-BYOK-Base-Url": baseUrl };
}

function byokHeadersFor(config: ByokConfig): Record<string, string> {
  return {
    "X-BYOK-Provider": config.provider,
    "X-BYOK-Key": config.apiKey,
    "X-BYOK-Model": config.model,
    ...baseUrlHeader(config),
  };
}

/** `{}` when no config is saved (or during SSR, or storage is blocked); the
 * full BYOK header set otherwise — spread into the chat transport's
 * outgoing request headers. */
export function byokHeaders(): Record<string, string> {
  const config = getByokConfig();
  return config === null ? {} : byokHeadersFor(config);
}
