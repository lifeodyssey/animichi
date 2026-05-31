"use client";

import { useDict } from "../../lib/i18n-context";
import { ErrorRetryTicket } from "../generative/ErrorRetryTicket";

export interface ResultPanelEmptyStateProps {
  /** When true, renders the error-retry-ticket instead of the empty state. */
  isError?: boolean;
  onRetry?: () => void;
  onEditQuery?: () => void;
}

/**
 * Empty state for the result panel when no search has been made yet.
 * Shows a centered message with gradient background and pulsing dots.
 * When isError=true, renders the error-retry-ticket (state 12 error path).
 * Design reference: variant-G-empty-states.html
 */
export function ResultPanelEmptyState({
  isError = false,
  onRetry,
  onEditQuery,
}: ResultPanelEmptyStateProps) {
  const { grid } = useDict();

  if (isError) {
    return (
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
        <ErrorRetryTicket
          onRetry={onRetry ?? (() => {})}
          onEditQuery={onEditQuery}
        />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      {/* Radial gradient background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 70% at 50% 50%, rgba(241, 143, 67, 0.08), transparent 70%)",
        }}
      />

      <div className="relative flex flex-col items-center gap-4 text-center">
        {/* Search icon */}
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        {/* Message */}
        <p className="font-display text-lg font-semibold text-foreground opacity-70">
          {grid.empty_hint ?? "聖地を探してみよう"}
        </p>

        <p className="max-w-[240px] text-xs font-light leading-relaxed text-muted-foreground">
          {grid.empty_subtitle ?? "アニメのタイトルを入力すると、聖地巡礼スポットがここに表示されます"}
        </p>

        {/* Pulsing dots */}
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-primary"
              style={{
                opacity: 0.4,
                animation: `pulse 1.5s ease-in-out ${i * 0.3}s infinite`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Pulse keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
