"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { useDict } from "@/lib/i18n-context";

// ---------------------------------------------------------------------------
// ChatSummaryCard props
// ---------------------------------------------------------------------------

export interface ChatSummaryCardProps {
  summary: string;
  area: string;
  duration: string;
  transport: string;
  spotCount: number;
  timestamp?: string;
  foxSrc?: string;
  onViewDetails?: () => void;
  onAdoptPlan?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// SummaryRow — single table row
// ---------------------------------------------------------------------------

interface SummaryRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function SummaryRow({ icon, label, value }: SummaryRowProps) {
  return (
    <tr>
      <td className="py-1.5 pr-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
      </td>
      <td className="py-1.5 text-xs font-medium text-foreground">{value}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// FoxAvatar — fox image or fallback initial
// ---------------------------------------------------------------------------

function FoxAvatar({ src }: { src?: string }) {
  return (
    <div
      data-testid="fox-avatar"
      className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-card"
    >
      {src ? (
        <Image src={src} alt="" fill className="object-cover" sizes="36px" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm font-bold text-primary">
          聖
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatSummaryCard
// ---------------------------------------------------------------------------

export function ChatSummaryCard({
  summary,
  area,
  duration,
  transport,
  spotCount,
  timestamp,
  foxSrc,
  onViewDetails,
  onAdoptPlan,
  className,
}: ChatSummaryCardProps) {
  const dict = useDict();
  const t = dict.chat_summary_card;

  const spotsValue = `${spotCount}か所`;

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-4 shadow-card",
        className,
      )}
    >
      {/* Header: avatar + bot name + timestamp */}
      <div className="mb-3 flex items-center gap-2">
        <FoxAvatar src={foxSrc} />
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-foreground">
            Seichijunrei AI
          </span>
          {timestamp && (
            <span className="text-xs text-muted-foreground">{timestamp}</span>
          )}
        </div>
      </div>

      {/* Summary prose */}
      <p className="mb-4 text-sm leading-relaxed text-foreground">{summary}</p>

      {/* Summary table */}
      <div className="mb-4 rounded-xl bg-muted/50 px-3 py-2">
        <table className="w-full border-separate border-spacing-0">
          <tbody>
            <SummaryRow icon={<AreaIcon />} label={t.area_label} value={area} />
            <SummaryRow icon={<ClockIcon />} label={t.duration_label} value={duration} />
            <SummaryRow icon={<BusIcon />} label={t.transport_label} value={transport} />
            <SummaryRow icon={<PinIcon />} label={t.spots_label} value={spotsValue} />
          </tbody>
        </table>
      </div>

      {/* CTA row */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onViewDetails}
          className={cn(
            "flex flex-1 items-center justify-center rounded-full border border-border px-3 py-2 text-xs font-medium text-foreground",
            "bg-card shadow-3d-sm",
            "active:translate-y-0.5 active:shadow-none",
            "hover:border-primary hover:text-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1",
            "transition-all duration-100",
          )}
        >
          {t.view_details}
        </button>

        <button
          type="button"
          onClick={onAdoptPlan}
          className={cn(
            "flex flex-1 items-center justify-center rounded-full px-3 py-2 text-xs font-semibold",
            "bg-[var(--color-cta)] text-[var(--color-cta-fg)]",
            "shadow-3d-md",
            "active:translate-y-0.5 active:shadow-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1",
            "transition-all duration-100",
          )}
        >
          {t.adopt_plan}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Micro-icons (12px, inline, aria-hidden)
// ---------------------------------------------------------------------------

function AreaIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M2 7h12" />
      <path d="M7 2v12" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 2" />
    </svg>
  );
}

function BusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="9" rx="2" />
      <path d="M2 7h12" />
      <circle cx="5" cy="13" r="1" />
      <circle cx="11" cy="13" r="1" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2C5.79 2 4 3.79 4 6c0 3.5 4 8 4 8s4-4.5 4-8c0-2.21-1.79-4-4-4z" />
      <circle cx="8" cy="6" r="1.5" />
    </svg>
  );
}
