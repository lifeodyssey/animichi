import type { ChatStatus } from "ai";
import { useEffect, useRef, useState } from "react";
import type { ChatTimingReporter } from "./telemetry";
import { recordChatTiming } from "./telemetry";

interface Tracker {
  startedAt: number;
  firstToken: boolean;
}

function onSubmitted(ref: Tracker): void {
  ref.startedAt = Date.now();
  ref.firstToken = false;
}

function reportFirstToken(ref: Tracker, report: ChatTimingReporter): void {
  if (ref.firstToken) return;
  ref.firstToken = true;
  report({ kind: "first_token", ms: Date.now() - ref.startedAt });
}

function settleTurn(ref: Tracker, report: ChatTimingReporter): number {
  const ms = Date.now() - ref.startedAt;
  ref.startedAt = 0;
  report({ kind: "turn", ms });
  return ms;
}

/** One status transition → the settled turn duration, or undefined mid-turn. */
function stepTiming(status: ChatStatus, ref: Tracker, report: ChatTimingReporter): number | undefined {
  if (status === "submitted") { onSubmitted(ref); return undefined; }
  if (ref.startedAt === 0) return undefined;
  if (status === "streaming") { reportFirstToken(ref, report); return undefined; }
  return settleTurn(ref, report);
}

function applyTiming(
  status: ChatStatus,
  ref: Tracker,
  report: ChatTimingReporter,
  setLast: (ms: number) => void,
): void {
  const ms = stepTiming(status, ref, report);
  if (ms !== undefined) setLast(ms);
}

/** Times each turn: first-token latency (submitted→streaming) + total duration. */
export function useTurnTiming(status: ChatStatus, report: ChatTimingReporter = recordChatTiming) {
  const [lastDurationMs, setLastDurationMs] = useState<number>();
  const tracker = useRef<Tracker>({ startedAt: 0, firstToken: false });
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    applyTiming(status, tracker.current, reportRef.current, setLastDurationMs);
  }, [status]);
  return lastDurationMs;
}
