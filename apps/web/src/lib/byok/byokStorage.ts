/**
 * Session-scoped BYOK credential storage (issue #284 Task 6, X10).
 *
 * `sessionStorage` only — never `localStorage` — so closing the tab drops
 * the key. This module is the **only** place allowed to touch
 * `sessionStorage` for BYOK; a repo-wide grep test enforces that no
 * component calls it directly. SSR-safe: no `window` access at import time,
 * and every accessor checks availability first and degrades to "no
 * credential" rather than throwing.
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

export type ByokSaveError = "model_required";
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

function hasSessionStorage(): boolean {
  return typeof window === "undefined" ? false : typeof window.sessionStorage !== "undefined";
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

function readRaw(key: string): string | null {
  if (!hasSessionStorage()) return null;
  return window.sessionStorage.getItem(key);
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

/** `null` when absent, during SSR, or the stored value is corrupt/non-JSON. */
export function getByokConfig(): ByokConfig | null {
  return parseConfig(readRaw(CONFIG_KEY));
}

/** Pure validation the settings panel can call before (and instead of)
 * attempting a save, to render its inline message synchronously. */
export function validateByokConfig(config: ByokConfig): ByokSaveResult {
  const modelMissing = config.provider === "openai-compatible" && config.model.trim() === "";
  return modelMissing ? { ok: false, error: "model_required" } : { ok: true };
}

/**
 * Persists the config and clears any vision flag left over from a prior
 * credential — a new key's vision support is unknown until it is re-probed.
 * A no-op during SSR. Rejects (without writing) when validation fails.
 */
export function saveByokConfig(config: ByokConfig): ByokSaveResult {
  const result = validateByokConfig(config);
  if (!result.ok) return result;
  if (hasSessionStorage()) {
    window.sessionStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    window.sessionStorage.removeItem(VISION_KEY);
  }
  return result;
}

/** Drops the credential and its vision flag together — never one without
 * the other, so a stale vision badge can never outlive its key. */
export function clearByokConfig(): void {
  if (!hasSessionStorage()) return;
  window.sessionStorage.removeItem(CONFIG_KEY);
  window.sessionStorage.removeItem(VISION_KEY);
}

/** Records the outcome of a `/v1/byok/probe` call (Task 5) against the
 * currently saved credential. */
export function setByokVisionSupported(supported: boolean): void {
  if (!hasSessionStorage()) return;
  window.sessionStorage.setItem(VISION_KEY, supported ? "true" : "false");
}

/** `null` when no probe has run yet for the current credential. */
export function getByokVisionSupported(): boolean | null {
  const raw = readRaw(VISION_KEY);
  return raw === null ? null : raw === "true";
}

function baseUrlHeader(config: ByokConfig): Record<string, string> {
  const { provider, baseUrl } = config;
  if (provider !== "openai-compatible" || baseUrl === undefined) return {};
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

/** `{}` when no config is saved (or during SSR); the full BYOK header set
 * otherwise — spread into the chat transport's outgoing request headers. */
export function byokHeaders(): Record<string, string> {
  const config = getByokConfig();
  return config === null ? {} : byokHeadersFor(config);
}
