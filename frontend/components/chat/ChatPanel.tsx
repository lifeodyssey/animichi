"use client";

import { useState } from "react";
import type { ChatMessage } from "../../lib/types";
import type { Dict, Locale } from "../../lib/i18n";
import type { LayoutMode } from "../../hooks/useLayoutMode";
import WelcomeScreen from "./WelcomeScreen";
import MessageList from "./MessageList";
import ChatInput from "../chat/ChatInput";
import { cn } from "../../lib/utils";

interface ChatPanelProps {
  messages: ChatMessage[];
  sending: boolean;
  activeMessageId: string | null;
  dict: Dict;
  locale: Locale;
  onSend: (text: string, coords?: { lat: number; lng: number } | null) => void;
  onActivate: (messageId: string) => void;
  onOpenDrawer?: () => void;
  isMobile?: boolean;
  /** Adaptive layout mode — controls width and centering. */
  layoutMode?: LayoutMode;
}

export default function ChatPanel({
  messages,
  sending,
  activeMessageId,
  dict,
  locale,
  onSend,
  onActivate,
  onOpenDrawer,
  isMobile = false,
  layoutMode = "chat",
}: ChatPanelProps) {
  const isEmpty = messages.length === 0;
  const [acquiredCoords, setAcquiredCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  function handleLocationAcquired(lat: number, lng: number) {
    setAcquiredCoords({ lat, lng });
  }

  function handleSend(text: string) {
    onSend(text, acquiredCoords);
  }

  // In chat mode (no results), center the content at a comfortable reading width.
  // In split mode, the container is already constrained to 340px by the parent.
  const isCentered = !isMobile && layoutMode === "chat";

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 w-full flex-col bg-background",
        !isMobile && layoutMode === "split" && "border-r border-border",
      )}
    >
      {/* Content area */}
      <div className="flex min-h-0 flex-1 flex-col">
        {isEmpty ? (
          /* Welcome screen: fills entire content area, has its own input */
          <WelcomeScreen onSend={handleSend} dict={dict} locale={locale} />
        ) : (
          /* Messages: centered at comfortable reading width */
          <div className={cn(
            "flex min-h-0 flex-1 flex-col",
            isCentered && "mx-auto w-full max-w-[640px]",
          )}>
            <MessageList
              messages={messages}
              onActivate={onActivate}
              activeMessageId={activeMessageId}
              onOpenDrawer={isMobile ? onOpenDrawer : undefined}
            />
          </div>
        )}
        {/* ChatInput — hidden on welcome (input is inside WelcomeScreen), shown when chatting */}
        {!isEmpty && (
          <div className={cn(
            isCentered && "mx-auto w-full max-w-[640px]",
          )}>
            <ChatInput
              onSend={handleSend}
              disabled={sending}
              showQuickActions={false}
              onLocationAcquired={handleLocationAcquired}
            />
          </div>
        )}
      </div>
    </div>
  );
}
