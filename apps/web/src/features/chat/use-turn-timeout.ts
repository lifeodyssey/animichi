import type { ChatStatus } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** The server owns a 100s whole-agent deadline. Keep the browser watchdog
 * behind it so the typed timeout envelope can reach the UI before aborting. */
export const TURN_TIMEOUT_MS = 110_000;

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

/** D5 watchdog: stop only after the server's typed timeout had time to arrive. */
export function useTurnTimeout(status: ChatStatus, stop: () => void): TurnTimeout {
  const [timedOut, setTimedOut] = useState(false);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const active = isActiveTurn(status);
  useEffect(() => (active ? armWatchdog(stopRef, setTimedOut) : undefined), [active]);
  const reset = useCallback(() => { setTimedOut(false); }, []);
  return { timedOut, reset };
}
