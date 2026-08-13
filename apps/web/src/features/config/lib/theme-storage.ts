/**
 * Theme persistence adapter (issue #1009 AC2): the **only** module allowed to
 * touch `localStorage` for the day/night theme.
 *
 * Components and hooks (`use-theme.ts`, `theme-bootstrap.ts`) never touch
 * storage directly — they read and write through these typed functions, so the
 * source-level guard in `tests/unit/state-ownership/architecture.test.ts` can
 * keep the adapter allowlist exact. SSR-safe: every accessor checks `window`
 * first and degrades to "no stored theme" rather than throwing, and the
 * storage access itself is wrapped in `try`/`catch` for browsers whose
 * storage accessor raises a `SecurityError` (partitioned/blocked storage).
 */

export type Theme = "day" | "night";

/** The key the pre-hydration bootstrap script embeds too. */
export const THEME_STORAGE_KEY = "animichi-theme";

function storedThemeStore(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isTheme(value: unknown): value is Theme {
  return value === "day" || value === "night";
}

/** `null` when absent, during SSR, storage is blocked, or the value is garbage. */
export function readStoredTheme(): Theme | null {
  const store = storedThemeStore();
  if (store === undefined) return null;
  try {
    const raw = store.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist the day/night choice; a no-op when storage is unavailable. */
export function writeStoredTheme(theme: Theme): void {
  const store = storedThemeStore();
  if (store === undefined) return;
  try {
    store.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable or over quota — the theme just won't survive reload.
  }
}
