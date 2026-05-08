"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useSession } from "../../hooks/useSession";
import { usePointSelection } from "../../hooks/usePointSelection";
import { useLocale, useDict } from "../../lib/i18n-context";
import { useLayoutMode } from "../../hooks/useLayoutMode";
import { useRouteSelection } from "../../hooks/useRouteSelection";
import { useChatTransport } from "../../hooks/useChatTransport";
import { PointSelectionContext } from "../../contexts/PointSelectionContext";
import { SuggestContext } from "../../contexts/SuggestContext";
import { isVisualResponse } from "../generative/registry";
import { isRouteData } from "../../lib/types";
import { cn } from "../../lib/utils";
import type { ChatMessage } from "../../lib/types";
import type { UIMessage } from "ai";
import SharedHeader from "./SharedHeader";
import ChatPanel from "../chat/ChatPanel";
import ResultSheet from "./ResultSheet";
import ResultPanel from "./ResultPanel";
import type { SeichijunreiMessage } from "../../lib/types/chat";

// ---------------------------------------------------------------------------
// Compatibility bridge: map AI SDK UIMessage → legacy ChatMessage shape.
// TEMPORARY — Card C will update ChatPanel/MessageList to consume
// UIMessage.parts directly, at which point this function is removed.
// ---------------------------------------------------------------------------
function toCompatMessage(msg: UIMessage): ChatMessage {
  const text = msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  return {
    id: msg.id,
    role: msg.role as "user" | "assistant",
    text,
    timestamp: Date.now(),
    loading: false,
  };
}

// ---------------------------------------------------------------------------
// AppShell — adaptive layout shell
//
// Desktop: SharedHeader + centered welcome OR split (chat 35% + map 65%)
// Mobile:  SharedHeader + full-screen ChatPanel + ResultSheet bottom drawer
// ---------------------------------------------------------------------------

export default function AppShell() {
  const locale = useLocale();
  const dict = useDict();
  const { sessionId, setSessionId, clearSession } = useSession();

  const transport = useChatTransport(sessionId, locale);

  const { messages, sendMessage, status, setMessages, stop } = useChat<SeichijunreiMessage>({
    transport,
    onFinish: ({ message }) => {
      const sid = (message as SeichijunreiMessage).metadata?.session_id;
      if (sid) setSessionId(sid);
    },
  });

  const sending = status === "streaming" || status === "submitted";

  const { selectedIds, toggle, clear: clearSelectedPoints } = usePointSelection();
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // For the transition period, downstream components still expect ChatMessage[].
  // Map UIMessage → ChatMessage via toCompatMessage. Card C will update
  // ChatPanel and MessageList to consume UIMessage.parts directly.
  const legacyMessages = useMemo(
    () => messages.map(toCompatMessage),
    [messages],
  );

  const activeMessage = useMemo(
    () => activeMessageId
      ? (legacyMessages.find((m) => m.id === activeMessageId && m.response && isVisualResponse(m.response)) ?? null)
      : null,
    [activeMessageId, legacyMessages],
  );

  const activeResponse = activeMessage?.response ?? null;

  // ── Adaptive layout ─────────────────────────────────────────────────
  const layout = useLayoutMode(activeResponse !== null, activeMessageId);
  const { mode, isMobile } = layout;

  const defaultOrigin = useMemo(() => {
    for (let index = legacyMessages.length - 1; index >= 0; index -= 1) {
      const routeHistory = legacyMessages[index]?.response?.route_history ?? [];
      const origin = routeHistory.find((entry) => entry.origin_station)?.origin_station;
      if (origin) return origin;
    }
    return "";
  }, [legacyMessages]);

  // Auto-activate latest visual response
  useEffect(() => {
    if (legacyMessages.length === 0) return;
    const last = legacyMessages[legacyMessages.length - 1];
    if (last.role !== "assistant" || last.loading || !last.response) return;
    if (!isVisualResponse(last.response)) return;
    const id = last.id;
    const mobile = isMobile;
    queueMicrotask(() => {
      setActiveMessageId(id);
      if (mobile) setDrawerOpen(true);
    });
  }, [legacyMessages, isMobile]);

  const handleSend = useCallback(
    (text: string, _coords?: { lat: number; lng: number } | null) => {
      clearSelectedPoints();
      setActiveMessageId(null);
      setDrawerOpen(false);
      sendMessage({ text });
    },
    [clearSelectedPoints, sendMessage],
  );

  const handleActivate = useCallback((messageId: string) => {
    setActiveMessageId((current) => {
      const newId = current === messageId ? null : messageId;
      if (newId && isMobile) setDrawerOpen(true);
      else if (!newId) setDrawerOpen(false);
      return newId;
    });
  }, [isMobile]);

  // Route selection still uses the legacy ChatMessage-based API.
  // We provide stub helpers until route selection is migrated in a later card.
  const appendMessages = useCallback((..._msgs: ChatMessage[]) => {
    // No-op during transition
  }, []);
  const replaceMessage = useCallback((_id: string, _updater: (m: ChatMessage) => ChatMessage) => {
    // No-op during transition
  }, []);
  const removeMessage = useCallback((_id: string) => {
    // No-op during transition
  }, []);

  const { routeSending, handleRouteSelected, handleRouteConfirmed, abortRoute } = useRouteSelection({
    selectedIds,
    sessionId,
    locale,
    isSending: sending,
    setSessionId,
    appendMessages,
    replaceMessage,
    removeMessage,
    clearSelectedPoints,
    setActiveMessageId,
    setDrawerOpen,
  });

  const handleNewChat = useCallback(() => {
    abortRoute();
    stop();
    setMessages([]);
    clearSelectedPoints();
    clearSession();
    setActiveMessageId(null);
    setDrawerOpen(false);
  }, [abortRoute, stop, setMessages, clearSelectedPoints, clearSession]);

  const isSending = sending || routeSending;
  const isRouteResult = activeResponse?.data ? isRouteData(activeResponse.data) : false;

  return (
    <SuggestContext.Provider value={{ onSuggest: handleSend }}>
      <PointSelectionContext.Provider value={{ selectedIds, toggle, clear: clearSelectedPoints }}>
        <div className="flex h-screen flex-col overflow-hidden bg-background">

          {/* ── SharedHeader with chat actions ───────────────────── */}
          <SharedHeader>
            <button
              type="button"
              onClick={handleNewChat}
              className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-fg transition-opacity hover:opacity-90"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {dict.sidebar.new_chat.replace(/^\+\s*/, "")}
            </button>
            {/* History + Settings hidden until features are implemented */}
          </SharedHeader>

          {/* ── Content area: adaptive layout ──────────────────── */}
          <main className="flex min-h-0 flex-1 overflow-hidden">

            {/* Chat panel — visible in chat + split modes */}
            {mode !== "full-result" && (
              <div
                data-testid="chat-panel"
                className={cn(
                  "flex min-h-0 flex-col",
                  isMobile && "flex-1",
                  !isMobile && mode === "chat" && "flex-1",
                  !isMobile && mode === "split" && "w-[35%] min-w-[340px] max-w-[440px] shrink-0",
                )}
              >
                <ChatPanel
                  messages={legacyMessages}
                  sending={isSending}
                  activeMessageId={activeMessageId}
                  dict={dict}
                  locale={locale}
                  onSend={handleSend}
                  onActivate={handleActivate}
                  onOpenDrawer={isMobile ? () => setDrawerOpen(true) : undefined}
                  isMobile={isMobile}
                  layoutMode={isMobile ? "chat" : mode}
                />
              </div>
            )}

            {/* Result panel — visible in split + full-result modes (desktop only) */}
            {!isMobile && mode !== "chat" && (
              <div
                data-testid="result-panel"
                className="entrance-slide-right flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              >
                <ResultPanel
                  activeResponse={activeResponse}
                  onRouteConfirmed={handleRouteConfirmed}
                  defaultOrigin={defaultOrigin}
                  loading={isSending && (isRouteResult || !activeResponse)}
                />
              </div>
            )}
          </main>

          {/* ── Mobile result sheet ─────────────────────────────── */}
          {isMobile && (
            <ResultSheet
              response={activeResponse}
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              onRouteSelected={handleRouteSelected}
              defaultOrigin={defaultOrigin}
              loading={isSending}
            />
          )}
        </div>
      </PointSelectionContext.Provider>
    </SuggestContext.Provider>
  );
}
