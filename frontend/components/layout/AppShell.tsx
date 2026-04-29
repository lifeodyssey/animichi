"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useChat } from "../../hooks/useChat";
import { usePointSelection } from "../../hooks/usePointSelection";
import { useLocale, useDict } from "../../lib/i18n-context";
import { useLayoutMode } from "../../hooks/useLayoutMode";
import { useRouteSelection } from "../../hooks/useRouteSelection";
import { PointSelectionContext } from "../../contexts/PointSelectionContext";
import { SuggestContext } from "../../contexts/SuggestContext";
import { isVisualResponse } from "../generative/registry";
import { isRouteData } from "../../lib/types";
import { cn } from "../../lib/utils";
import IconSidebar from "./IconSidebar";
import ChatPanel from "../chat/ChatPanel";
import ResultSheet from "./ResultSheet";
import ResultPanel from "./ResultPanel";
import ChatPopup from "../chat/ChatPopup";

// ---------------------------------------------------------------------------
// Sidebar overlay — tablet / mobile
// ---------------------------------------------------------------------------

function SidebarOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
        style={{ animation: "fade-in 0.15s ease-out" }}
      />
      <div
        className="fixed bottom-0 left-0 top-0 z-50"
        style={{ animation: "slide-in-left 0.2s var(--ease-out-expo)" }}
      >
        {children}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AppShell — map-first adaptive layout
// ---------------------------------------------------------------------------

export default function AppShell() {
  const locale = useLocale();
  const dict = useDict();
  const { sessionId, setSessionId, clearSession } = useSession();

  const handleTitleUpdate = useCallback(
    (_sid: string, _title: string) => { /* conversation history disabled */ },
    [],
  );

  const {
    messages,
    send,
    sending,
    clear: clearChat,
    appendMessages,
    replaceMessage,
    removeMessage,
  } = useChat(sessionId, setSessionId, locale, handleTitleUpdate);
  const { selectedIds, toggle, clear: clearSelectedPoints } = usePointSelection();
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatPopupOpen, setChatPopupOpen] = useState(false);

  const activeMessage = useMemo(
    () => activeMessageId
      ? (messages.find((m) => m.id === activeMessageId && m.response && isVisualResponse(m.response)) ?? null)
      : null,
    [activeMessageId, messages],
  );

  const activeResponse = activeMessage?.response ?? null;

  // ── Adaptive layout ──
  const layout = useLayoutMode(activeResponse !== null, activeMessageId);
  const { isMobile, isTablet } = layout;
  const showPermanentSidebar = !isMobile && !isTablet;
  const showOverlaySidebar = isMobile || isTablet;
  const hasResults = activeResponse !== null;

  const defaultOrigin = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const routeHistory = messages[index]?.response?.route_history ?? [];
      const origin = routeHistory.find((entry) => entry.origin_station)?.origin_station;
      if (origin) return origin;
    }
    return "";
  }, [messages]);

  // Auto-activate latest visual response + open chat popup on desktop
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant" || last.loading || !last.response) return;
    if (!isVisualResponse(last.response)) return;
    const id = last.id;
    const mobile = isMobile;
    const isRoute = last.response.data ? isRouteData(last.response.data) : false;
    queueMicrotask(() => {
      setActiveMessageId(id);
      if (mobile) setDrawerOpen(true);
      else setChatPopupOpen(!isRoute);
    });
  }, [messages, isMobile]);

  const handleSend = useCallback(
    (text: string, coords?: { lat: number; lng: number } | null) => {
      clearSelectedPoints();
      setActiveMessageId(null);
      setDrawerOpen(false);
      setChatPopupOpen(true); // Open chat popup when user sends
      send(text, coords);
    },
    [clearSelectedPoints, send],
  );

  const handleActivate = useCallback((messageId: string) => {
    setActiveMessageId((current) => {
      const newId = current === messageId ? null : messageId;
      if (newId && isMobile) setDrawerOpen(true);
      else if (!newId) setDrawerOpen(false);
      return newId;
    });
  }, [isMobile]);

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
    clearChat();
    clearSelectedPoints();
    clearSession();
    setActiveMessageId(null);
    setDrawerOpen(false);
    setSidebarOpen(false);
    setChatPopupOpen(false);
  }, [abortRoute, clearChat, clearSelectedPoints, clearSession]);

  const handleSidebarSection = useCallback(
    (_section: "history" | "favorites" | "settings") => {
      setSidebarOpen(false);
    },
    [],
  );

  const isSending = sending || routeSending;
  const isRouteResult = activeResponse?.data ? isRouteData(activeResponse.data) : false;

  return (
    <SuggestContext.Provider value={{ onSuggest: handleSend }}>
      <PointSelectionContext.Provider value={{ selectedIds, toggle, clear: clearSelectedPoints }}>
        <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">

          {/* ── Desktop sidebar ── */}
          {showPermanentSidebar && (
            <IconSidebar
              onNewChat={handleNewChat}
              onSectionClick={handleSidebarSection}
            />
          )}

          {/* ── Tablet/mobile sidebar overlay ── */}
          {showOverlaySidebar && sidebarOpen && (
            <SidebarOverlay onClose={() => setSidebarOpen(false)}>
              <IconSidebar
                onNewChat={() => { handleNewChat(); setSidebarOpen(false); }}
                onSectionClick={handleSidebarSection}
              />
            </SidebarOverlay>
          )}

          {/* ── Main content: map-first layout ── */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

            {/* Mobile: chat panel when no results */}
            {isMobile && !hasResults && (
              <div data-testid="chat-panel" className="flex min-h-0 flex-1 flex-col">
                <ChatPanel
                  messages={messages}
                  sending={isSending}
                  activeMessageId={activeMessageId}
                  dict={dict}
                  locale={locale}
                  onSend={handleSend}
                  onActivate={handleActivate}
                  onOpenDrawer={() => setDrawerOpen(true)}
                  isMobile={isMobile}
                  layoutMode="chat"
                  onMenuOpen={showOverlaySidebar ? () => setSidebarOpen(true) : undefined}
                />
              </div>
            )}

            {/* Desktop: result panel always visible (full width) */}
            {!isMobile && (
              <div
                data-testid="result-panel"
                className={cn(
                  "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                  hasResults && "animate-[panel-slide-in_0.3s_var(--ease-out-expo)]",
                )}
              >
                <ResultPanel
                  activeResponse={activeResponse}
                  onRouteConfirmed={handleRouteConfirmed}
                  defaultOrigin={defaultOrigin}
                  loading={isSending && (isRouteResult || !activeResponse)}
                />
              </div>
            )}

            {/* Mobile: result panel when results exist */}
            {isMobile && hasResults && (
              <div data-testid="result-panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <ResultPanel
                  activeResponse={activeResponse}
                  onRouteConfirmed={handleRouteConfirmed}
                  defaultOrigin={defaultOrigin}
                  loading={isSending}
                />
              </div>
            )}
          </div>

          {/* ── Mobile result sheet ── */}
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

          {/* ── Chat popup — always available ── */}
          <ChatPopup
            open={chatPopupOpen}
            onClose={() => setChatPopupOpen((prev) => !prev)}
            messages={messages}
            sending={isSending}
            activeMessageId={activeMessageId}
            onSend={handleSend}
            onActivate={handleActivate}
          />
        </div>
      </PointSelectionContext.Provider>
    </SuggestContext.Provider>
  );
}
