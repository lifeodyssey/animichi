"use client";

import { useDict } from "../../lib/i18n-context";

interface ChatHeaderProps {
  onNewChat?: () => void;
  onMenuToggle?: () => void;
}

export default function ChatHeader({ onNewChat, onMenuToggle }: ChatHeaderProps) {
  const { header: t, sidebar: s } = useDict();

  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-5">
      <div className="flex items-center gap-2">
        {onMenuToggle && (
          <button
            type="button"
            onClick={onMenuToggle}
            className="rounded-lg p-2 hover:bg-primary/5 transition"
            style={{ transitionDuration: "var(--duration-fast)" }}
            aria-label="Toggle sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </button>
        )}
        <h1 className="font-display text-sm font-semibold text-foreground">
          {t.title}
        </h1>
      </div>
      {onNewChat && (
        <button
          type="button"
          onClick={onNewChat}
          className="rounded-md px-3 py-1.5 text-xs font-light text-primary transition hover:bg-muted"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          {s.new_chat}
        </button>
      )}
    </header>
  );
}
