/**
 * The P5 deferred save intent (issue #273 S1.7).
 *
 * A magic link is opened from an email client, i.e. a **new browsing context**,
 * so neither React state nor `sessionStorage` survives the navigation —
 * `sessionStorage` is tab-scoped and would simply be absent, making the deferred
 * save fail silently. `localStorage` is origin-scoped and does survive. URL
 * state is rejected: it would leak the point ids into the magic-link redirect,
 * the email client and any referrer chain. The entry carries no `session_id`
 * (the new tab has none) and a short TTL bounds an abandoned login so a stale
 * intent cannot resurrect a save weeks later.
 */

/** Namespaced key: one origin, one versioned intent slot. */
export const DEFERRED_SAVE_KEY = "animichi.chat.deferredSave.v1";

/** Abandonment bound: an intent older than this is ignored and erased. */
export const DEFERRED_SAVE_TTL_MS = 30 * 60_000;

/** What the post-login replay needs, and nothing more. */
export interface DeferredSaveIntent {
  readonly pointIds: readonly string[];
  readonly title: string;
  readonly createdAt: number;
}

/** SSR and privacy-locked browsers have no store; both read as "no intent". */
function store(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isIntent(value: unknown): value is DeferredSaveIntent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isStringArray(record.pointIds) && typeof record.title === "string" && typeof record.createdAt === "number";
}

function parse(raw: string): DeferredSaveIntent | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isIntent(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function clearDeferredSave(): void {
  store()?.removeItem(DEFERRED_SAVE_KEY);
}

/** Stash the intent behind the login wall; `now` is injectable for tests. */
export function writeDeferredSave(
  intent: Readonly<{ pointIds: readonly string[]; title: string }>,
  now: number = Date.now(),
): void {
  const entry: DeferredSaveIntent = { pointIds: [...intent.pointIds], title: intent.title, createdAt: now };
  store()?.setItem(DEFERRED_SAVE_KEY, JSON.stringify(entry));
}

/** The live intent, or `undefined` — a missing, malformed or expired entry is
 * erased rather than replayed. */
export function readDeferredSave(now: number = Date.now()): DeferredSaveIntent | undefined {
  const raw = store()?.getItem(DEFERRED_SAVE_KEY);
  const intent = raw === null || raw === undefined ? undefined : parse(raw);
  if (intent === undefined) return undefined;
  if (now - intent.createdAt > DEFERRED_SAVE_TTL_MS) {
    clearDeferredSave();
    return undefined;
  }
  return intent;
}
