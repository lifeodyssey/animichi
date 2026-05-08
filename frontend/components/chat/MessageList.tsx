"use client";

import { useEffect, useRef } from "react";
import type { UIMessage, ChatStatus } from "ai";
import { useDict } from "../../lib/i18n-context";
import { useSuggest } from "../../contexts/SuggestContext";
import MessageBubble from "./MessageBubble";

interface MessageListProps {
  messages: UIMessage[];
  onActivate?: (messageId: string) => void;
  activeMessageId?: string | null;
  onOpenDrawer?: () => void;
  /** Chat status from useChat — used to determine if the last message is streaming. */
  status?: ChatStatus;
}

export default function MessageList({
  messages,
  onActivate,
  activeMessageId,
  onOpenDrawer,
  status,
}: MessageListProps) {
  const { chat: t, clarification } = useDict();
  const onSuggest = useSuggest();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-8">
        <div
          className="entrance-message-slow w-full max-w-md rounded-[28px] border border-border bg-[color-mix(in_oklab,var(--color-card)_88%,var(--color-bg))] p-6 shadow-hero"
        >
          <div className="flex flex-col gap-3">
            <p className="font-display text-3xl text-foreground">
              {t.welcome_title}
            </p>
            <p className="text-sm font-light leading-7 text-foreground">
              {t.welcome_subtitle}
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-2.5">
            {clarification.suggestions.map((s, idx) => (
              <button
                key={s.label}
                type="button"
                onClick={() => onSuggest(s.query)}
                className="entrance-message flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-left text-sm font-light text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                style={{
                  transitionDuration: "var(--duration-fast)",
                  animationDelay: `${100 + idx * 60}ms`,
                }}
              >
                <span>{s.label}</span>
                <span aria-hidden>→</span>
              </button>
            ))}
          </div>

          <p
            className="entrance-message mt-5 text-xs font-light leading-6 text-muted-foreground"
            style={{ animationDelay: "320ms" }}
          >
            {t.welcome_helper}
          </p>
        </div>
      </div>
    );
  }

  const isStreaming = status === "streaming" || status === "submitted";

  return (
    <div className="flex-1 overflow-y-auto py-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5">
        {messages.map((msg, idx) => {
          const isLast = idx === messages.length - 1;
          return (
            <div
              key={msg.id}
              className="entrance-message"
              style={{ animationDelay: `${Math.min(idx * 40, 200)}ms` }}
            >
              <MessageBubble
                message={msg}
                onActivate={onActivate}
                isActive={msg.id === activeMessageId}
                onOpenDrawer={onOpenDrawer}
                isStreaming={isLast && isStreaming}
              />
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
