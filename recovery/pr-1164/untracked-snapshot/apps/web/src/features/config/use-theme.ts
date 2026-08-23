import { useCallback, useEffect, useRef, useState } from "react";
import {
  readStoredTheme,
  type Theme,
  writeStoredTheme,
} from "./lib/theme-storage";

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  writeStoredTheme(theme);
}

/** Read the persisted preference exactly once, adopt it into state, and apply
 * it — the mount-time counterpart to the `[theme]` effect below. */
function adoptStoredTheme(setTheme: (theme: Theme) => void): void {
  const stored = readStoredTheme();
  const initial = stored ?? "day";
  setTheme(initial);
  applyTheme(initial);
}

/** Apply + persist the current theme, skipping the initial run (the mount
 * effect already applied it) so storage is never re-read and re-written. */
function applyThemeAfterAdoption(isInitialApply: { current: boolean }, theme: Theme): void {
  if (isInitialApply.current) {
    isInitialApply.current = false;
    return;
  }
  applyTheme(theme);
}

export interface ThemeControl {
  theme: Theme;
  set: (theme: Theme) => void;
}

/** Day/night theme, persisted through the `theme-storage` adapter; SSR renders
 * the day default, and the stored preference is adopted once on hydration.
 *
 * Storage is read only in the mount effect; the `[theme]` effect only ever
 * applies and persists the current value, so an adopted night preference is
 * never re-read and re-written into a day/night oscillation. */
export function useTheme(): ThemeControl {
  const [theme, setTheme] = useState<Theme>("day");
  const isInitialApply = useRef(true);

  useEffect(() => { adoptStoredTheme(setTheme); }, []);
  useEffect(() => { applyThemeAfterAdoption(isInitialApply, theme); }, [theme]);

  const set = useCallback((next: Theme) => { setTheme(next); }, []);
  return { theme, set };
}
