import { useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

const TICK_MS = 250;

function runClock(active: boolean, startedAt: RefObject<number>, set: Dispatch<SetStateAction<number>>) {
  if (!active) { set(0); return undefined; }
  startedAt.current = Date.now();
  const id = setInterval(() => { set(Date.now() - startedAt.current); }, TICK_MS);
  return () => { clearInterval(id); };
}

/** Live elapsed-ms ticker for the turn-waiting ritual; zero while inactive. */
export function useTurnClock(active: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef(0);
  useEffect(() => runClock(active, startedAt, setElapsedMs), [active]);
  return elapsedMs;
}
