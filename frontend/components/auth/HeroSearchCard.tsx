"use client";

import { Search, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeroSearchCardProps {
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: (q: string) => void;
  examples: string[];
  onChip: (example: string) => void;
  placeholder: string;
  ctaLabel: string;
  nearbyLabel: string;
  authHint: string;
  locationLabel: string;
  routePreviewLabel: string;
}

export default function HeroSearchCard({
  query,
  onQueryChange,
  onSearch,
  examples,
  onChip,
  placeholder,
  ctaLabel,
  nearbyLabel,
  authHint,
  locationLabel,
  routePreviewLabel,
}: HeroSearchCardProps) {
  const isEmpty = !query.trim();

  return (
    <div
      data-testid="route-preview"
      className="overflow-hidden rounded-[24px] border border-border bg-card/95 shadow-popup backdrop-blur-sm"
    >
      {/* Route preview header */}
      <RoutePreviewBar locationLabel={locationLabel} routePreviewLabel={routePreviewLabel} />

      {/* Search row */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <div className="relative flex flex-1 items-center">
          <Search
            size={15}
            className="pointer-events-none absolute left-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch(query)}
            placeholder={placeholder}
            className={cn(
              "w-full rounded-[50px] border border-border bg-background py-2.5 pl-9 pr-4",
              "text-[13px] text-foreground placeholder:text-muted-foreground",
              "shadow-3d-sm",
              "focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-1",
              "transition-shadow duration-150",
            )}
          />
        </div>

        {/* Gold CTA */}
        <button
          type="button"
          disabled={isEmpty}
          onClick={() => onSearch(query)}
          className={cn(
            "animal-btn animal-btn-cta",
            "flex shrink-0 items-center gap-1.5 rounded-[50px] px-4 py-2.5 text-[13px] font-semibold",
            isEmpty && "cursor-not-allowed opacity-50",
          )}
          aria-label={ctaLabel}
        >
          <Search size={13} aria-hidden="true" />
          {ctaLabel}
        </button>
      </div>

      {/* Example chips */}
      <ExampleChips examples={examples} onChip={onChip} />

      {/* Nearby badge + auth hint */}
      <div className="flex items-center justify-between px-4 pb-3.5 pt-1">
        <button
          type="button"
          onClick={() => onChip(nearbyLabel)}
          className="flex items-center gap-1.5 rounded-[50px] border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition-shadow hover:shadow-md"
        >
          <MapPin size={11} className="text-error-fg" aria-hidden="true" />
          {nearbyLabel}
        </button>
        <p className="text-[11px] text-muted-foreground">{authHint}</p>
      </div>
    </div>
  );
}

// ── Route preview bar (pins + dashed arc) ────────────────────────────────────

function RoutePreviewBar({
  locationLabel,
  routePreviewLabel,
}: {
  locationLabel: string;
  routePreviewLabel: string;
}) {
  return (
    <div className="relative border-b border-border bg-muted/50 px-4 py-3">
      <p className="text-center text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
        {routePreviewLabel}
      </p>
      <div className="relative mt-2 flex items-center justify-between px-6">
        <RoutePin color="var(--color-primary)" />
        {/* Dashed arc */}
        <svg className="absolute inset-x-12 top-2 h-6 w-[calc(100%-6rem)]" viewBox="0 0 300 24" fill="none" preserveAspectRatio="none">
          <path d="M0 20 C60 2,120 22,180 8 C240 -4,280 16,300 10" stroke="var(--color-primary)" strokeWidth="2" strokeDasharray="8 5" strokeLinecap="round" opacity="0.5" />
        </svg>
        <RoutePin color="var(--color-error-fg)" />
      </div>
      <p className="mt-1.5 text-center text-[11px] font-medium text-foreground">{locationLabel}</p>
    </div>
  );
}

function RoutePin({ color }: { color: string }) {
  return (
    <svg width="20" height="26" viewBox="0 0 36 46" fill="none" aria-hidden="true" className="relative z-10 shrink-0">
      <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 28 18 28s18-14.5 18-28C36 8.06 27.94 0 18 0z" fill={color} />
      <circle cx="18" cy="17" r="7" fill="var(--color-bg)" />
    </svg>
  );
}

// ── Example chips ─────────────────────────────────────────────────────────────

function ExampleChips({
  examples,
  onChip,
}: {
  examples: string[];
  onChip: (example: string) => void;
}) {
  if (!examples.length) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 pb-2 pt-2">
      {examples.map((ex) => (
        <button
          key={ex}
          type="button"
          data-testid={`example-chip-${ex}`}
          onClick={() => onChip(ex)}
          className="rounded-[50px] border border-border bg-background px-3 py-1 text-[12px] font-medium text-foreground shadow-sm transition-[transform,box-shadow,border-color,color] duration-150 hover:-translate-y-px hover:border-primary hover:text-primary hover:shadow-md"
        >
          {ex}
        </button>
      ))}
    </div>
  );
}
