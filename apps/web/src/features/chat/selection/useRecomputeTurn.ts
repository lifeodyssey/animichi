import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { selectedPointsBody } from "../../../lib/chat/selectedPointsBypass";
import type { SelectedPointsBody } from "../../../lib/chat/selectedPointsBypass";
import type { RecomputeStatus } from "../components/SelectionTray";
import type { ChatSession } from "../use-chat-session";

/**
 * Tracks the E2 recompute turn (issue #273 S1.7): `fire` sends the bypass
 * body; the settle watcher classifies the turn as idle again or failed. A
 * failed recompute stays on the tray — ChatPage masks the full-page
 * `TurnFailure` surface while this hook reports `failed`.
 */
export interface RecomputeTurn {
  readonly status: RecomputeStatus;
  readonly lastSentIds: readonly string[] | undefined;
  readonly fire: (ids: readonly string[]) => void;
}

function isActive(status: ChatSession["status"]): boolean {
  return status === "submitted" || status === "streaming";
}

type SetStatus = (status: RecomputeStatus) => void;
type SetIds = (ids: readonly string[]) => void;
type SendBypass = (body: SelectedPointsBody) => void;

/** The guard: an empty selection produces no body, so the bypass never fires empty. */
function fireRecompute(ids: readonly string[], send: SendBypass, setStatus: SetStatus, setIds: SetIds): void {
  const body = selectedPointsBody(ids);
  if (body === undefined) return;
  setIds(body.selected_point_ids);
  setStatus("busy");
  send(body);
}

function useFire(chat: ChatSession, setStatus: SetStatus, setIds: SetIds) {
  const { sendSelectedPoints } = chat;
  return useCallback(
    (ids: readonly string[]) => {
      fireRecompute(ids, sendSelectedPoints, setStatus, setIds);
    },
    [sendSelectedPoints, setStatus, setIds],
  );
}

type ChatStatus = ChatSession["status"];

/** A busy recompute settles once its turn went active and came back. */
function settleBusy(chatStatus: ChatStatus, error: Error | undefined, started: RefObject<boolean>, setStatus: SetStatus): void {
  if (isActive(chatStatus)) {
    started.current = true;
    return;
  }
  if (started.current) setStatus(error === undefined ? "idle" : "failed");
}

/** One watcher step; a later non-recompute turn going active clears a stale verdict. */
function stepWatcher(status: RecomputeStatus, chatStatus: ChatStatus, error: Error | undefined, started: RefObject<boolean>, setStatus: SetStatus): void {
  if (status === "busy") {
    settleBusy(chatStatus, error, started, setStatus);
    return;
  }
  started.current = false;
  if (status === "failed" && isActive(chatStatus)) setStatus("idle");
}

function useSettleWatcher(status: RecomputeStatus, chat: ChatSession, setStatus: SetStatus): void {
  const started = useRef(false);
  const { status: chatStatus, error } = chat;
  useEffect(() => {
    stepWatcher(status, chatStatus, error, started, setStatus);
  }, [status, chatStatus, error, setStatus]);
}

export function useRecomputeTurn(chat: ChatSession): RecomputeTurn {
  const [status, setStatus] = useState<RecomputeStatus>("idle");
  const [lastSentIds, setLastSentIds] = useState<readonly string[]>();
  const fire = useFire(chat, setStatus, setLastSentIds);
  useSettleWatcher(status, chat, setStatus);
  return { status, lastSentIds, fire };
}
