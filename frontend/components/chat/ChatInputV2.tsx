"use client";

import { useState, useRef, type KeyboardEvent } from "react";

interface ChatInputV2Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  /** Override the default placeholder text. */
  placeholderOverride?: string;
}

/**
 * ChatInput v2 — search-bar style.
 *
 * Slim pill shape, shadow instead of border, single-line input.
 * Send button animates in when text is present.
 */
export default function ChatInputV2({
  onSend,
  disabled,
  placeholderOverride,
}: ChatInputV2Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const placeholder =
    placeholderOverride ?? "アニメ名や行きたい場所を入力…";

  function handleSubmit() {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  const hasText = text.trim().length > 0;

  return (
    <div
      className="px-3 pb-4 pt-2"
      style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
    >
      <div
        className="mx-auto flex w-full items-center gap-2.5 rounded-full bg-[var(--color-bg)] px-4"
        style={{
          height: "44px",
          boxShadow:
            "0 1px 6px rgba(61, 52, 40, 0.06), 0 0 0 1px rgba(196, 184, 158, 0.5)",
          transitionProperty: "box-shadow",
          transitionDuration: "var(--duration-fast)",
        }}
      >
        {/* Search icon */}
        <svg
          className="shrink-0 text-[var(--color-muted-fg)]"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>

        {/* Single-line input */}
        <input
          ref={inputRef}
          type="text"
          aria-label={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent text-sm leading-normal outline-none placeholder:text-[var(--color-muted-fg)] disabled:opacity-50"
          style={{ fontFamily: "var(--app-font-body)" }}
        />

        {/* Send button — slides in when text exists */}
        <button
          onClick={handleSubmit}
          disabled={disabled || !hasText}
          className="flex shrink-0 items-center justify-center rounded-full transition-all"
          style={{
            width: hasText || disabled ? "30px" : "0px",
            height: "30px",
            opacity: hasText || disabled ? 1 : 0,
            overflow: "hidden",
            background: hasText
              ? "var(--color-primary)"
              : "var(--color-muted)",
            color: hasText ? "white" : "var(--color-muted-fg)",
            transitionDuration: "var(--duration-base)",
            transitionTimingFunction: "var(--ease-out-quint)",
          }}
          aria-label="送信"
        >
          {disabled ? (
            <span className="flex items-center gap-0.5">
              {([0, 0.2, 0.4] as const).map((delay) => (
                <span
                  key={delay}
                  className="inline-block h-1 w-1 rounded-full bg-current"
                  style={{
                    animation: "breathe 1.2s ease-in-out infinite",
                    animationDelay: `${delay}s`,
                  }}
                />
              ))}
            </span>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
