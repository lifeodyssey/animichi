import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { isTurnActive } from "../lib/turn-gate";
import type { RecomputeStatus } from "../components/SelectionTray";
import type { ChatSession } from "../use-chat-session";

/**
 * Settlement watcher shared by the fired selection turns (point recompute and
 * clarify-candidate pick): a `busy` turn settles once its chat turn went
 * active and came back — `idle` on success, `failed` on a settled error.
 */

export type SetSelectionStatus = (status: RecomputeStatus) => void;

type WatcherStep = Readonly<{
  status: RecomputeStatus;
  chatStatus: ChatSession["status"];
  error: Error | undefined;
  started: RefObject<boolean>;
  setStatus: SetSelectionStatus;
}>;

/** A busy selection settles once its turn went active and came back. */
function settleBusy({ chatStatus, error, started, setStatus }: WatcherStep): void {
  if (isTurnActive(chatStatus)) {
    started.current = true;
    return;
  }
  if (started.current) setStatus(error === undefined ? "idle" : "failed");
}

/** One watcher step; a later non-selection turn going active clears a stale verdict. */
function stepWatcher(step: WatcherStep): void {
  if (step.status === "busy") {
    settleBusy(step);
    return;
  }
  step.started.current = false;
  if (step.status === "failed" && isTurnActive(step.chatStatus)) step.setStatus("idle");
}

export function useSelectionSettle(status: RecomputeStatus, chat: ChatSession, setStatus: SetSelectionStatus): void {
  const started = useRef(false);
  const { status: chatStatus, error } = chat;
  useEffect(() => {
    stepWatcher({ status, chatStatus, error, started, setStatus });
  }, [status, chatStatus, error, setStatus]);
}
