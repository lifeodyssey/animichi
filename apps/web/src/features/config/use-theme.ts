import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  readStoredTheme,
  type Theme,
  writeStoredTheme,
} from "./lib/theme-storage";

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  writeStoredTheme(theme);
}

/** The pre-hydration root script seeds the document on a browser reload. The
 * hook keeps its first render at the SSR day default, then adopts that seed in
 * a layout effect before paint; component mounts without the script read the
 * typed adapter directly. */
function seededTheme(): Theme | undefined {
  if (typeof document !== "undefined") {
    const seeded = document.documentElement.dataset.theme;
    if (seeded === "day" || seeded === "night") return seeded;
  }
  return undefined;
}

export interface ThemeControl {
  theme: Theme;
  set: (theme: Theme) => void;
}

function adoptTheme(theme: Theme, setTheme: (theme: Theme) => void, adopted: { current: boolean }): boolean {
  if (adopted.current) return false;
  adopted.current = true;
  const persisted = seededTheme() ?? readStoredTheme();
  if (persisted === null || persisted === theme) return false;
  setTheme(persisted);
  return true;
}

/** Day/night theme, persisted through the `theme-storage` adapter; SSR and the
 * first client render use the day default, then the stored preference is
 * adopted once on hydration. */
export function useTheme(): ThemeControl {
  const [theme, setTheme] = useState<Theme>("day");
  const adopted = useRef(false);

  useLayoutEffect(() => {
    if (adoptTheme(theme, setTheme, adopted)) return;
    applyTheme(theme);
  }, [theme]);

  const set = useCallback((next: Theme) => { setTheme(next); }, []);
  return { theme, set };
}
