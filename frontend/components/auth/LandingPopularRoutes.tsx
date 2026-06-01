"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDict } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { type AnimeGalleryItem, handleImageError } from "./LandingData";

// ── Route card tags derived from gallery metadata ──────────────────────────

const ROUTE_TAGS: Record<string, string[]> = {
  "115908": ["school", "river"],
  "160209": ["city", "nature"],
  "269235": ["city", "sky"],
  "328609": ["street", "live house"],
  "1424": ["school", "countryside"],
  "362577": ["journey", "ruins"],
  "100444": ["city", "school"],
  "27364": ["old town", "nature"],
};

// ── Sub-components ─────────────────────────────────────────────────────────

function LocationStamps({ count }: { count: string }) {
  const parts = count.split("·");
  const location = parts[1]?.trim() ?? "";
  const spots = parts[0]?.trim() ?? "";
  return (
    <div className="flex items-center gap-1.5">
      <MapPin size={11} className="shrink-0 text-primary" aria-hidden="true" />
      <span className="text-[11px] text-muted-foreground">{location}</span>
      <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[12px] font-medium text-muted-foreground">
        {spots}
      </span>
    </div>
  );
}

function TagRow({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-border bg-background px-2 py-0.5 text-[12px] text-muted-foreground"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function RouteCard({
  item,
  index,
  addRevealRef,
}: {
  item: AnimeGalleryItem;
  index: number;
  addRevealRef: (el: HTMLElement | null) => void;
}) {
  const tags = ROUTE_TAGS[item.bangumiId] ?? [];

  return (
    <Link
      href={`/anime/${item.bangumiId}`}
      ref={addRevealRef}
      className={cn(
        "seichi-reveal-pop group flex flex-col overflow-hidden rounded-[18px]",
        "border border-border bg-card",
        "transition-[transform,box-shadow,border-color] duration-300 ease-[var(--ease-out-expo)]",
        "hover:-translate-y-1.5 hover:shadow-card",
      )}
      style={{ animationDelay: `${index * 0.06}s` }}
      aria-label={item.title}
    >
      {/* Cover image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={`/images/bangumi/${item.bangumiId}.jpg`}
          alt={item.title}
          loading={index < 2 ? "eager" : "lazy"}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          onError={handleImageError}
        />
        {/* Compare icon badge */}
        <div className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-card/90 shadow-sm">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M4 2L1 7L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/60" />
            <path d="M10 2L13 7L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/60" />
          </svg>
        </div>
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-[14px] font-bold leading-snug text-foreground">
          {item.title}
        </h3>
        <LocationStamps count={item.count} />
        <TagRow tags={tags} />
      </div>
    </Link>
  );
}

function EmptyRoutes({ emptyText }: { emptyText: string }) {
  return (
    <div className="col-span-full flex flex-col items-center gap-3 py-16 text-center">
      <span className="text-[40px]" aria-hidden="true">🗺️</span>
      <p className="text-[14px] text-muted-foreground">{emptyText}</p>
    </div>
  );
}

// ── Public component ───────────────────────────────────────────────────────

interface LandingPopularRoutesProps {
  items: AnimeGalleryItem[];
  onOpenAuth: (query?: string) => void;
}

export function LandingPopularRoutes({ items, onOpenAuth: _onOpenAuth }: LandingPopularRoutesProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;
  const addRevealRef = useScrollReveal();

  return (
    <section className="bg-background px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-16">
      <div className="mx-auto max-w-[1100px]">
        {/* Header row */}
        <div
          ref={addRevealRef}
          className="seichi-reveal mb-8 flex flex-wrap items-end justify-between gap-4"
        >
          <div>
            <h2 className="font-display text-[clamp(20px,3vw,26px)] font-bold text-foreground">
              {t.popular_title}
            </h2>
            <p className="mt-1 max-w-[480px] text-[13px] leading-relaxed text-muted-foreground">
              {t.popular_sub}
            </p>
          </div>
          <Link
            href="/anime"
            className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
          >
            {t.popular_view_all} →
          </Link>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.length === 0 ? (
            <EmptyRoutes emptyText={t.popular_empty} />
          ) : (
            items.map((item, i) => (
              <RouteCard key={item.bangumiId} item={item} index={i} addRevealRef={addRevealRef} />
            ))
          )}
        </div>

        {/* Browse before login prompt */}
        <p
          ref={addRevealRef}
          className="seichi-reveal mt-8 text-center text-[12px] text-muted-foreground"
        >
          {t.hero_auth_hint}
        </p>
      </div>
    </section>
  );
}
