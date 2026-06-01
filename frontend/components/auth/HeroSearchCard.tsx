"use client";

import { Search, MapPin, Navigation } from "lucide-react";
import { Card, Divider } from "animal-island-ui";
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
  locationLabel,
  routePreviewLabel,
}: HeroSearchCardProps) {
  const isEmpty = !query.trim();

  return (
    <Card
      data-testid="route-preview"
      className="cursor-default overflow-visible px-5 pb-5 pt-4"
    >
      {/* Route preview bar */}
      <RoutePreviewBar
        locationLabel={locationLabel}
        routePreviewLabel={routePreviewLabel}
      />

      {/* Divider between preview and search */}
      <div className="my-3">
        <Divider type="dashed-teal" />
      </div>

      {/* Pill search input */}
      <div className="relative flex items-center">
        <Search
          size={15}
          className="pointer-events-none absolute left-4 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch(query)}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-[50px] border border-border bg-background py-3 pl-10 pr-4",
            "text-[13px] text-foreground placeholder:text-muted-foreground",
            "shadow-3d-sm",
            "focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-1",
            "transition-shadow duration-150",
          )}
        />
      </div>

      {/* Big orange CTA */}
      <button
        type="button"
        disabled={isEmpty}
        onClick={() => onSearch(query)}
        className={cn(
          "animal-btn animal-btn-cta",
          "mt-3 flex w-full items-center justify-center gap-2 rounded-[50px] py-3 text-[15px] font-bold",
          isEmpty && "cursor-not-allowed opacity-50",
        )}
        aria-label={ctaLabel}
      >
        <Navigation size={15} aria-hidden="true" />
        {ctaLabel}
      </button>

      {/* Example chips */}
      <ExampleChips examples={examples} onChip={onChip} />

      {/* Nearby button */}
      <button
        type="button"
        onClick={() => onChip(nearbyLabel)}
        className="mt-2 flex items-center gap-1.5 rounded-[50px] border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition-shadow hover:shadow-md"
      >
        <MapPin size={11} className="text-error-fg" aria-hidden="true" />
        {nearbyLabel}
      </button>
    </Card>
  );
}

// ── Route preview (dashed arc + pins) ────────────────────────────────────────

function RoutePreviewBar({
  locationLabel,
  routePreviewLabel,
}: {
  locationLabel: string;
  routePreviewLabel: string;
}) {
  return (
    <div className="relative">
      <p className="text-center text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        {routePreviewLabel}
      </p>
      <div className="relative mt-2.5 flex items-center justify-between px-4">
        <RoutePin color="var(--color-primary)" />
        <svg
          className="absolute inset-x-10 top-2 h-7 w-[calc(100%-5rem)]"
          viewBox="0 0 300 28"
          fill="none"
          preserveAspectRatio="none"
        >
          <path
            d="M0 22 C50 4,100 24,160 10 C220 -4,270 18,300 12"
            stroke="var(--color-primary)"
            strokeWidth="2.5"
            strokeDasharray="8 5"
            strokeLinecap="round"
            opacity="0.65"
          />
        </svg>
        <RoutePin color="var(--color-error-fg)" />
      </div>
      <p className="mt-1 text-center text-[11px] font-medium text-foreground">
        {locationLabel}
      </p>
    </div>
  );
}

function RoutePin({ color }: { color: string }) {
  return (
    <svg
      width="22"
      height="28"
      viewBox="0 0 36 46"
      fill="none"
      aria-hidden="true"
      className="relative z-10 shrink-0"
    >
      <path
        d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 28 18 28s18-14.5 18-28C36 8.06 27.94 0 18 0z"
        fill={color}
      />
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
    <div className="mt-3 flex flex-wrap gap-2">
      {examples.map((ex) => (
        <button
          key={ex}
          type="button"
          data-testid={`example-chip-${ex}`}
          onClick={() => onChip(ex)}
          className="rounded-[50px] border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground shadow-sm transition-[transform,box-shadow,border-color,color] duration-150 hover:-translate-y-px hover:border-primary hover:text-primary hover:shadow-md"
        >
          {ex}
        </button>
      ))}
    </div>
  );
}
