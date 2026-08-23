/**
 * Locale persistence adapter: the **only** module allowed to touch
 * `localStorage` for the visitor's chosen UI language, and therefore the entry
 * the state-ownership gate's adapter allowlist names
 * (`tests/unit/state-ownership/architecture.test.ts`).
 *
 * Priority, decided with this control: a stored choice is an explicit act and
 * outranks `navigator.languages`, which is only ever a guess. `LocaleProvider`
 * reads this first and falls back to `detectLocale()`, so a visitor who never
 * touched the switcher keeps following the browser exactly as before.
 *
 * It lives under `lib/` for the same reason `lib/byok/byok-storage.ts` does: a
 * browser-storage adapter is platform-adjacent plumbing, and the state-ownership
 * gate requires every adapter but the pre-hydration bootstrap to sit under
 * `lib/` or `features/`. SSR-safe and failure-safe in the same shape as
 * `features/config/lib/theme-storage.ts`: every
 * accessor checks `window`, wraps the storage access in `try`/`catch` (a
 * partitioned/blocked store throws on access), and degrades to "no choice
 * stored" instead of throwing.
 */

import { isLocale, type Locale } from "../../i18n/locales";

export const LOCALE_STORAGE_KEY = "animichi-locale";

function localeStore(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** `null` when absent, during SSR, storage is blocked, or the value is garbage. */
export function readStoredLocale(): Locale | null {
  const store = localeStore();
  if (store === undefined) return null;
  try {
    const raw = store.getItem(LOCALE_STORAGE_KEY);
    return raw !== null && isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist the chosen language; a no-op when storage is unavailable. */
export function writeStoredLocale(locale: Locale): void {
  const store = localeStore();
  if (store === undefined) return;
  try {
    store.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage unavailable or over quota — the choice just won't survive reload.
  }
}
