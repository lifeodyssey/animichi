"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { useDict } from "@/lib/i18n-context";

// ---------------------------------------------------------------------------
// PostageEdge — CSS stamp-style dashed border on right side
// ---------------------------------------------------------------------------

function PostageEdge() {
  return (
    <div
      aria-hidden="true"
      className="absolute right-0 top-0 flex h-full flex-col justify-around"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-3 w-3 rounded-full bg-background" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToriiStampSmall — small corner stamp (bottom-right)
// ---------------------------------------------------------------------------

function ToriiStampSmall() {
  return (
    <div
      aria-hidden="true"
      className="absolute bottom-2 right-5 flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-border bg-card/80"
    >
      <svg width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden="true">
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
// RecentRouteCard props
// ---------------------------------------------------------------------------

export interface RecentRouteCardProps {
  title: string;
  locations: string[];
  spotCount: number;
  updatedWhen: string;
  thumbnailSrc?: string;
  onClick?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// RecentRouteCard
// ---------------------------------------------------------------------------

export function RecentRouteCard({
  title,
  locations,
  spotCount,
  updatedWhen,
  thumbnailSrc,
  onClick,
  className,
}: RecentRouteCardProps) {
  const dict = useDict();
  const t = dict.recent_route_card;

  const spotsText =
    spotCount === 0
      ? t.no_spots
      : t.spots_count.replace("{count}", String(spotCount));

  const locationText = locations.join("・");
  const updatedText = t.updated.replace("{when}", updatedWhen);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full overflow-hidden rounded-2xl border border-border bg-card text-left",
        "shadow-card transition-all duration-150",
        "hover:-translate-y-0.5 hover:shadow-popup",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1",
        className,
      )}
    >
      {/* Resume vertical label — green teal strip on the left */}
      <div className="flex w-8 shrink-0 items-center justify-center bg-primary">
        <span
          className="font-body text-xs font-semibold text-primary-foreground [writing-mode:vertical-rl]"
        >
          {t.resume_label}
        </span>
      </div>

      {/* Thumbnail */}
      <div className="relative h-28 w-28 shrink-0 overflow-hidden bg-muted">
        {thumbnailSrc ? (
          <Image
            src={thumbnailSrc}
            alt={t.thumbnail_alt.replace("{title}", title)}
            fill
            className="object-cover"
            sizes="112px"
          />
        ) : (
          <div
            data-testid="thumbnail-placeholder"
            className="flex h-full w-full items-center justify-center text-muted-foreground"
            aria-hidden="true"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="relative flex flex-1 flex-col justify-between px-4 py-3 pr-8">
        <div className="flex flex-col gap-0.5">
          <p className="font-display text-sm font-semibold leading-snug text-foreground line-clamp-2">
            {title}
          </p>
          {locationText && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <LocationIcon />
              {locationText}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{spotsText}</p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{updatedText}</p>

        <ToriiStampSmall />
      </div>

      <PostageEdge />
    </button>
  );
}

function LocationIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2C5.79 2 4 3.79 4 6c0 3.5 4 8 4 8s4-4.5 4-8c0-2.21-1.79-4-4-4z" />
      <circle cx="8" cy="6" r="1.5" />
    </svg>
  );
}
