"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import RouteLine from "@/components/landing/decor/RouteLine";
import LocationBadge from "@/components/landing/decor/LocationBadge";
import LeafSprig from "@/components/landing/decor/LeafSprig";
import TicketStub from "@/components/landing/decor/TicketStub";
import FoxGuide from "@/components/generative/FoxGuide";
import { useDict } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { type AnimeGalleryItem, handleImageError } from "./LandingData";

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

function splitCount(count: string): { spots: string; place: string } {
  const [spots, place] = count.split("·");
  return { spots: spots?.trim() ?? count, place: place?.trim() ?? "" };
}

// ── Route card ───────────────────────────────────────────────────────────────

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
  const { spots, place } = splitCount(item.count);

  return (
    <Link
      href={`/anime/${item.bangumiId}`}
      ref={addRevealRef}
      className={cn(
        "seichi-reveal-pop group flex flex-col overflow-hidden rounded-[18px] border border-border bg-card",
        "transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-expo)]",
        "hover:-translate-y-1.5 hover:shadow-card",
      )}
      style={{ animationDelay: `${index * 0.06}s` }}
      aria-label={item.title}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={`/images/bangumi/${item.bangumiId}.jpg`}
          alt={item.title}
          loading={index < 2 ? "eager" : "lazy"}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          onError={handleImageError}
        />
        {place ? (
          <LocationBadge name={place} className="absolute right-2 top-2" />
        ) : null}
        {/* Compare seam handle */}
        <div className="absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-card/90 shadow-sm">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M4 2L1 7L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55" />
            <path d="M10 2L13 7L10 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55" />
          </svg>
        </div>
        <span
          className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-background/70"
          aria-hidden="true"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <h3 className="font-display text-[15px] font-bold leading-snug text-fg-heading">
          {item.title}
        </h3>
        <p className="text-[12px] font-medium text-muted-foreground">
          <span className="text-fg">{spots}</span>
          {place ? ` · ${place}` : ""}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-[10px] border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-auto pt-1">
          <RouteLine />
        </div>
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

// ── Browse-before-login banner ───────────────────────────────────────────────

function BrowseBanner({ note }: { note: string }) {
  return (
    <div className="paper-surface relative mt-12 flex items-center gap-5 overflow-visible rounded-[20px] px-6 py-5 sm:px-8">
      <div className="relative hidden h-16 w-24 shrink-0 sm:block">
        <FoxGuide pose="traveler" size="lg" surface="welcome" className="-top-16 left-0" />
      </div>
      <p className="flex-1 text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-display text-[15px] font-bold text-fg-heading">
          Start browsing before login.
        </span>
        <br />
        {note}
      </p>
      <TicketStub label="Let's go!" rotate={5} className="hidden shrink-0 sm:flex" />
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
      <div className="mx-auto max-w-[1120px]">
        <div
          ref={addRevealRef}
          className="seichi-reveal mb-9 flex flex-wrap items-end justify-between gap-4"
        >
          <div className="flex items-start gap-2">
            <div>
              <h2 className="font-display text-[clamp(22px,3.2vw,30px)] font-bold text-fg-heading">
                {t.popular_title}
              </h2>
              <p className="mt-1.5 max-w-[480px] text-[13px] leading-relaxed text-muted-foreground">
                {t.popular_sub}
              </p>
            </div>
            <LeafSprig size={26} className="mt-1 hidden sm:block" />
          </div>
          <Link
            href="/anime"
            className="inline-flex items-center gap-1.5 rounded-[50px] border border-border bg-card px-4 py-2 text-[13px] font-bold text-fg shadow-3d-sm transition-transform hover:-translate-y-0.5"
          >
            {t.popular_view_all}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.length === 0 ? (
            <EmptyRoutes emptyText={t.popular_empty} />
          ) : (
            items
              .slice(0, 4)
              .map((item, i) => (
                <RouteCard key={item.bangumiId} item={item} index={i} addRevealRef={addRevealRef} />
              ))
          )}
        </div>

        <BrowseBanner note={t.hero_auth_hint} />
      </div>
    </section>
  );
}
