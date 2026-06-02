"use client";

import { MapPin, Navigation } from "lucide-react";
import RouteLine from "@/components/landing/decor/RouteLine";
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
}

/**
 * Right hero card — a field-journal plan page on the same parchment as the left
 * panel. The labelled scene→place route is the card's identity (not a footnote);
 * a recessed input well and a raised orange CTA build depth within the surface.
 */
export default function HeroSearchCard({
  query,
  onQueryChange,
  onSearch,
  examples,
  onChip,
  placeholder,
  ctaLabel,
  nearbyLabel,
}: HeroSearchCardProps) {
  return (
    <div
      data-testid="route-preview"
      className="paper-surface paper-stack paper-fold relative rotate-[1.2deg] cursor-default rounded-[22px] px-6 pb-6 pt-5"
    >
      {/* Route identity — the scene → real-place spine, labelled so it reads */}
      <div className="px-1">
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          Scene → real place
        </p>
        <RouteLine stops={1} className="mt-1.5" />
        <div className="mt-0.5 flex justify-between px-1 text-[10px] font-semibold">
          <span className="text-primary">anime scene</span>
          <span className="text-marker-active">real spot</span>
        </div>
      </div>

      <svg viewBox="0 0 240 6" className="mx-auto mt-3 h-1.5 w-full text-border" preserveAspectRatio="none" fill="none" aria-hidden="true">
        <path d="M2 3 C40 1.5, 80 4.5, 120 3 C160 1.5, 200 4.5, 238 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>

      {/* Recessed search input */}
      <div className="relative mt-3 flex items-center">
        <MapPin size={16} className="pointer-events-none absolute left-4 text-primary" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch(query)}
          placeholder={placeholder}
          className={cn(
            "input-well w-full rounded-[50px] border border-border bg-background/90 py-3.5 pl-11 pr-4",
            "text-[14px] text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-1 transition-shadow",
          )}
        />
      </div>

      {/* Raised orange CTA */}
      <button
        type="button"
        onClick={() => onSearch(query)}
        className="btn-explore mt-2.5 flex w-full items-center justify-center gap-2 py-3.5 text-[15px] font-bold"
        aria-label={ctaLabel}
      >
        <Navigation size={16} aria-hidden="true" />
        {ctaLabel}
      </button>

      {/* Example chips — warm-tinted, asymmetric */}
      <div className="mt-4 flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            data-testid={`example-chip-${ex}`}
            onClick={() => onChip(ex)}
            className="rounded-[50px] border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-fg shadow-sm transition-[transform,box-shadow,border-color,color] duration-150 hover:-translate-y-px hover:border-explore hover:text-explore hover:shadow-md"
          >
            {ex}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChip(nearbyLabel)}
          className="flex items-center gap-1.5 rounded-[50px] border border-explore/40 bg-explore/10 px-3 py-1.5 text-[12px] font-semibold text-explore shadow-sm transition-transform hover:-translate-y-px"
        >
          <MapPin size={12} aria-hidden="true" />
          {nearbyLabel}
        </button>
      </div>
    </div>
  );
}
