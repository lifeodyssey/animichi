import { useCallback, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { RouteDataState } from "./dataState";

/**
 * MODE (spec-route-detail §2): a form axis orthogonal to the data state — the
 * page toggles between a compact "idle" view and a map-expanded view with a
 * 360ms FLIP transition. Today defaults to expanded; every other state defaults
 * to idle. Expanding never surfaces the gold bar (that is data-driven).
 */
export type RouteMode = "idle" | "expanded";

/** FLIP transition budget, shared with the workbench "graduation" motion. */
export const MODE_TRANSITION_MS = 360;

/** The FLIP easing curve (spec-route-detail §2). */
export const MODE_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

/** The map-expanded timetable collapses into a 352px sheet. */
export const EXPANDED_SHEET_PX = 352;

export function nextMode(mode: RouteMode): RouteMode {
  return mode === "idle" ? "expanded" : "idle";
}

/** Today opens map-expanded; all other data states open idle. */
export function initialMode(state: RouteDataState): RouteMode {
  return state === "today" ? "expanded" : "idle";
}

export interface RouteModeControl {
  readonly mode: RouteMode;
  readonly toggle: () => void;
}

function runToggle(busy: RefObject<boolean>, setMode: Dispatch<SetStateAction<RouteMode>>): void {
  if (busy.current) return;
  busy.current = true;
  setMode(nextMode);
  window.setTimeout(() => {
    busy.current = false;
  }, MODE_TRANSITION_MS);
}

/** Mode state with a debounce guard so double-taps never half-transition (AC4). */
export function useRouteMode(initial: RouteMode): RouteModeControl {
  const [mode, setMode] = useState<RouteMode>(initial);
  const busy = useRef<boolean>(false);
  const toggle = useCallback(() => {
    runToggle(busy, setMode);
  }, []);
  return { mode, toggle };
}
