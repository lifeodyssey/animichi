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
import type { UIMessage } from "ai";
import type { ChatMessage, RuntimeResponse } from "../../lib/types";
import SharedHeader from "./SharedHeader";
import ChatPanel from "../chat/ChatPanel";
import ResultSheet from "./ResultSheet";
import ResultPanel from "./ResultPanel";
import type { SeichijunreiMessage } from "../../lib/types/chat";

// ---------------------------------------------------------------------------
// Helpers to extract RuntimeResponse from UIMessage tool parts.
// ---------------------------------------------------------------------------

/** Tool names whose output contains visual search/route results. */
const VISUAL_TOOL_NAMES = new Set([
  "search_bangumi", "search_by_bangumi", "search_nearby", "search_by_location",
  "plan_route", "plan_selected",
]);

function extractResponse(msg: UIMessage): RuntimeResponse | null {
  for (const part of msg.parts) {
    // Match both dynamic-tool and tool-{name} (AI SDK v6 static tool parts)
    const isDynamic = part.type === "dynamic-tool";
    const isToolPart = typeof part.type === "string" && part.type.startsWith("tool-");
    if (!isDynamic && !isToolPart) continue;
    const p = part as Record<string, unknown>;
    if (p.state !== "output-available") continue;
    const output = p.output;
    if (typeof output !== "object" || output === null) continue;

    // PydanticAI dispatch_request streams raw tool outputs.
    // Wrap them in a RuntimeResponse shape for the result panel.
    const toolName = (p.toolName as string) ?? (typeof part.type === "string" ? part.type.replace("tool-", "") : "");
    if (VISUAL_TOOL_NAMES.has(toolName)) {
      const raw = output as Record<string, unknown>;
      // search_bangumi returns {rows, row_count, status}
      if (Array.isArray(raw.rows)) {
        return {
          success: true,
          status: "ok",
          intent: "search_bangumi",
          message: "",
          data: { results: { rows: raw.rows as object[], row_count: (raw.row_count as number) ?? (raw.rows as unknown[]).length } },
        } as RuntimeResponse;
      }
      // plan_route returns {ordered_points, point_count, ...}
      if (Array.isArray(raw.ordered_points)) {
        return {
          success: true,
          status: "ok",
          intent: "plan_route",
          message: "",
          data: { route: raw },
        } as RuntimeResponse;
      }
    }

    // Legacy format: output already has intent field
    if ("intent" in output) {
      return output as RuntimeResponse;
    }
  }
  return null;
}

function extractVisualResponse(msg: UIMessage): RuntimeResponse | null {
  const response = extractResponse(msg);
  return response && isVisualResponse(response) ? response : null;
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

  const activeResponse = useMemo(
    () => activeMessageId
      ? (messages
          .filter((m) => m.id === activeMessageId)
          .map(extractVisualResponse)
          .find((r) => r !== null) ?? null)
      : null,
    [activeMessageId, messages],
  );

  // ── Adaptive layout ─────────────────────────────────────────────────
  const layout = useLayoutMode(activeResponse !== null, activeMessageId);
  const { mode, isMobile } = layout;

  const defaultOrigin = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const response = extractResponse(messages[index]);
      const routeHistory = response?.route_history ?? [];
      const origin = routeHistory.find((entry) => entry.origin_station)?.origin_station;
      if (origin) return origin;
    }
    return "";
  }, [messages]);

  // Auto-activate latest visual response
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return;
    // Don't activate while streaming
    if (sending) return;
    const visual = extractVisualResponse(last);
    if (!visual) return;
    const id = last.id;
    const mobile = isMobile;
    queueMicrotask(() => {
      setActiveMessageId(id);
      if (mobile) setDrawerOpen(true);
    });
  }, [messages, isMobile, sending]);

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

  // Route selection — stub helpers until route selection is migrated.
  const appendMessages = useCallback((..._msgs: ChatMessage[]) => {}, []);
  const replaceMessage = useCallback((_id: string, _updater: (m: ChatMessage) => ChatMessage) => {}, []);
  const removeMessage = useCallback((_id: string) => {}, []);

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
                  messages={messages}
                  sending={isSending}
                  activeMessageId={activeMessageId}
                  dict={dict}
                  locale={locale}
                  onSend={handleSend}
                  onActivate={handleActivate}
                  onOpenDrawer={isMobile ? () => setDrawerOpen(true) : undefined}
                  isMobile={isMobile}
                  layoutMode={isMobile ? "chat" : mode}
                  status={status}
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
