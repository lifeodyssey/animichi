"use client";

import { useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "seichi:recent-route";

export interface RecentRoute {
  bangumiId: string;
  title: string;
}

/**
 * Persist the last anime guide a visitor opened, so the public landing can
 * offer a "continue where you left off" accelerator on return. localStorage is
 * the right store here: it survives reloads, is per-device, and needs no auth —
 * browsing routes is a logged-out capability, so the resume path must be too.
 * Called from a click handler (client-only), so the bare access is safe.
 */
export function storeRecentRoute(route: RecentRoute): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(route));
  } catch {
    // private mode / quota / disabled storage — the accelerator is optional.
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Raw string snapshot keeps a stable identity for useSyncExternalStore. */
function getSnapshot(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Read the stored route. Null during SSR / first paint, then hydrated client-side. */
export function useRecentRoute(): RecentRoute | null {
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  return useMemo(() => parseRoute(raw), [raw]);
}

function parseRoute(raw: string | null): RecentRoute | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecentRoute(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecentRoute(value: unknown): value is RecentRoute {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).bangumiId === "string" &&
    typeof (value as Record<string, unknown>).title === "string"
  );
}
