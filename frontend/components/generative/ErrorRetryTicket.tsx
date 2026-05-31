"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useDict } from "@/lib/i18n-context";

// ---------------------------------------------------------------------------
// ToriiStamp — decorative perforated-edge ticket stamp (inline SVG)
// ---------------------------------------------------------------------------

function ToriiStamp({ alt }: { alt: string }) {
  return (
    <div
      data-testid="torii-stamp"
      aria-label={alt}
      className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-border bg-card"
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        {/* Torii gate — two pillars + crossbar + cap */}
        <rect x="5" y="20" width="3" height="8" rx="1" fill="var(--color-brand)" />
        <rect x="24" y="20" width="3" height="8" rx="1" fill="var(--color-brand)" />
        <rect x="3" y="14" width="26" height="3" rx="1.5" fill="var(--color-brand)" />
        <rect x="6" y="10" width="20" height="3" rx="1.5" fill="var(--color-brand)" />
        <rect x="9" y="7" width="14" height="2" rx="1" fill="var(--color-brand)" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PerforatedEdge — CSS-only ticket perforation on left/right sides
// ---------------------------------------------------------------------------

function PerforatedEdge({ side }: { side: "left" | "right" }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute top-0 flex h-full flex-col justify-around",
        side === "left" ? "-left-2" : "-right-2",
      )}
    >
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="h-4 w-4 rounded-full bg-background"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorRetryTicket props
// ---------------------------------------------------------------------------

export interface ErrorRetryTicketProps {
  onRetry: () => void;
  onEditQuery?: () => void;
  onRestart?: () => void;
  onReport?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// ErrorRetryTicket
// ---------------------------------------------------------------------------

export function ErrorRetryTicket({
  onRetry,
  onEditQuery,
  onRestart,
  onReport,
  className,
}: ErrorRetryTicketProps) {
  const dict = useDict();
  const t = dict.error_retry_ticket;

  // Prevent double-fire: disable Retry button after first click until
  // the parent re-renders (typically a state change after retry resolves).
  // The button shows a "pending" visual state so users know the click registered.
  const [retryFired, setRetryFired] = useState(false);

  const handleRetry = useCallback(() => {
    if (retryFired) return;
    setRetryFired(true);
    onRetry();
  }, [retryFired, onRetry]);

  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-sm rounded-3xl border border-border bg-card px-8 py-6 text-center shadow-card",
        className,
      )}
    >
      <PerforatedEdge side="left" />
      <PerforatedEdge side="right" />

      <ToriiStamp alt={t.stamp_alt} />

      <h2 className="font-display text-lg font-bold text-foreground">
        {t.heading}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t.body}
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {/* Primary row: Retry + Edit-query */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleRetry}
            disabled={retryFired}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all",
              "bg-primary text-primary-foreground",
              "shadow-3d-md",
              "active:translate-y-1 active:shadow-none",
              retryFired
                ? "cursor-wait opacity-70"
                : "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1",
            )}
          >
            {retryFired ? <SpinnerIcon /> : <RetryIcon />}
            {t.retry}
          </button>

          <button
            type="button"
            onClick={onEditQuery}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-all",
              "bg-card shadow-3d-md",
              "active:translate-y-1 active:shadow-none",
              "hover:border-primary hover:text-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1",
            )}
          >
            <EditIcon />
            {t.edit_query}
          </button>
        </div>

        {/* Secondary row: Restart + Report */}
        <div className="flex justify-center gap-6">
          {onRestart && (
            <button
              type="button"
              onClick={onRestart}
              className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              <HomeIcon />
              {t.restart}
            </button>
          )}
          {onReport && (
            <button
              type="button"
              onClick={onReport}
              className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              <FlagIcon />
              {t.report}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Micro-icons (16px, inline, aria-hidden)
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="animate-spin">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.8" strokeOpacity="0.3" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8a6 6 0 1 1 1.5 4" />
      <polyline points="2 12 2 8 6 8" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2.5l2.5 2.5-8 8H3v-2.5l8-8z" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8L8 2l6 6" />
      <path d="M4 6v7h3v-3h2v3h3V6" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v12" />
      <path d="M3 3h10l-2.5 4L13 11H3" />
    </svg>
  );
}
