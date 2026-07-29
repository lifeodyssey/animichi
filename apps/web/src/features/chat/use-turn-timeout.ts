import type { ChatStatus } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export const TURN_TIMEOUT_MS = 60_000;

export interface TurnTimeout {
  readonly timedOut: boolean;
  readonly reset: () => void;
}

function isActiveTurn(status: ChatStatus): boolean {
  return status === "submitted" || status === "streaming";
}

function armWatchdog(stopRef: RefObject<() => void>, setTimedOut: (value: boolean) => void): () => void {
  setTimedOut(false);
  const id = setTimeout(() => { setTimedOut(true); stopRef.current(); }, TURN_TIMEOUT_MS);
  return () => { clearTimeout(id); };
}

/** D5 watchdog: a turn running past 60s is stopped and flagged for fallback. */
export function useTurnTimeout(status: ChatStatus, stop: () => void): TurnTimeout {
  const [timedOut, setTimedOut] = useState(false);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const active = isActiveTurn(status);
  useEffect(() => (active ? armWatchdog(stopRef, setTimedOut) : undefined), [active]);
  const reset = useCallback(() => { setTimedOut(false); }, []);
  return { timedOut, reset };
}
