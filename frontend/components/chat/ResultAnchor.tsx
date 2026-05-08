"use client";

import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// ResultAnchor — soft white card with SVG pin icon
// ---------------------------------------------------------------------------

interface ResultAnchorProps {
  label: string;
  subtitle: string;
  messageId: string;
  onActivate?: (messageId: string) => void;
  isActive: boolean;
  onOpenDrawer?: () => void;
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.5A4.5 4.5 0 0 0 3.5 6c0 3.5 4.5 8.5 4.5 8.5s4.5-5 4.5-8.5A4.5 4.5 0 0 0 8 1.5Z" />
      <circle cx="8" cy="6" r="1.5" />
    </svg>
  );
}

export default function ResultAnchor({
  label,
  subtitle,
  messageId,
  onActivate,
  isActive,
  onOpenDrawer,
}: ResultAnchorProps) {
  return (
    <button
      type="button"
      onClick={() => {
        onActivate?.(messageId);
        onOpenDrawer?.();
      }}
      className={cn(
        "group/anchor flex w-full max-w-[320px] items-center gap-3 rounded-xl border p-3 text-left transition-all duration-150",
        isActive
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-card hover:border-primary/60 hover:-translate-y-0.5 hover:shadow-sm",
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <PinIcon className="h-4 w-4 text-primary" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <span className="shrink-0 text-sm text-muted-foreground transition-transform duration-150 group-hover/anchor:translate-x-0.5">
        {"\u203A"}
      </span>
    </button>
  );
}
