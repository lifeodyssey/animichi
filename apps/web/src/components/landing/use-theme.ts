import { useCallback, useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "../theme-bootstrap";

export type Theme = "day" | "night";

const STORAGE_KEY = THEME_STORAGE_KEY;

function readStored(): Theme | null {
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "day" || value === "night" ? value : null;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
}

export interface ThemeControl {
  theme: Theme;
  toggle: () => void;
}

/** Day/night theme persisted to localStorage; SSR renders the day default. */
export function useTheme(): ThemeControl {
  const [theme, setTheme] = useState<Theme>("day");
  useEffect(() => { const stored = readStored(); if (stored) setTheme(stored); }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const toggle = useCallback(() => { setTheme((current) => (current === "day" ? "night" : "day")); }, []);
  return { theme, toggle };
}
