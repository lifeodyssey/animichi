"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { useDict, useLocale } from "../../lib/i18n-context";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import LocationPrompt from "./LocationPrompt";

const SEARCH_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const SEND_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const DELAYS = [0, 0.2, 0.4] as const;

const LOADING_DOTS = (
  <span className="flex items-center gap-0.5">
    {DELAYS.map((delay) => (
      <span
        key={delay}
        className="inline-block h-1 w-1 rounded-full bg-current animate-breathe"
        style={{ animationDelay: `${delay}s` }}
      />
    ))}
  </span>
);

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  onLocationAcquired?: (lat: number, lng: number) => void;
  /** Override the default locale-aware placeholder text. */
  placeholderOverride?: string;
}

/**
 * Chat input — editorial search bar feel, not a support widget.
 *
 * Design direction: clean single-line input with a subtle border.
 * Send button appears only when there's content (progressive disclosure).
 */
export default function ChatInput({
  onSend,
  disabled,
  onLocationAcquired,
  placeholderOverride,
}: ChatInputProps) {
  const dict = useDict();
  const { chat: t } = dict;
  const locale = useLocale();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);

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

  function handleCoordsAcquired(lat: number, lng: number) {
    setShowLocationPrompt(false);
    onLocationAcquired?.(lat, lng);
  }

  function handleStationSubmit(station: string) {
    setShowLocationPrompt(false);
    onSend(station);
  }

  // Locale-aware placeholder
  const placeholder = placeholderOverride ?? (
    locale === "zh"
      ? "输入动漫名称，或描述你的巡礼计划…"
      : locale === "en"
        ? "Type an anime name, or describe your trip…"
        : "アニメ名を入力、または旅の計画を…"
  );

  const sendContent = disabled ? LOADING_DOTS : SEND_ICON;

  return (
    <div
      className="px-4 pb-4 pt-2"
      style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
    >
      {/* Location prompt overlay */}
      {showLocationPrompt && (
        <LocationPrompt
          onCoords={handleCoordsAcquired}
          onStation={handleStationSubmit}
          onDismiss={() => setShowLocationPrompt(false)}
          dict={dict}
          locale={locale}
        />
      )}

      {/* Input bar */}
      <div className="mx-auto flex w-full max-w-[520px] items-center gap-2">
        <Input shadow
          ref={inputRef}
          size="large"
          prefix={SEARCH_ICON}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="primary"
          size="small"
          onClick={handleSubmit}
          disabled={disabled || !hasText}
          aria-label={t.send}
          className={cn("animal-btn-icon-only", !hasText && !disabled && "opacity-30")}
        >
          {sendContent}
        </Button>
      </div>

      {/* Status feedback while AI is responding */}
      {disabled && (
        <p className="mt-1 text-center text-xs text-muted-foreground animate-pulse">
          {t.thinking}
        </p>
      )}

      {/* Keyboard shortcut hint — desktop only */}
      {!disabled && (
        <p className="mt-1 hidden text-center text-xs text-muted-foreground opacity-50 md:block">
          {t.send_hint ?? "Press Enter to send"}
        </p>
      )}
    </div>
  );
}
