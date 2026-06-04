"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import LeafSprig from "@/components/landing/decor/LeafSprig";
import RouteCard from "@/components/landing/popular-routes/RouteCard";
import BrowseBanner from "@/components/landing/popular-routes/BrowseBanner";
import { useDict } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { type AnimeGalleryItem } from "./LandingData";

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
          <PillButton asChild surface="card" size="sm" className="gap-1.5">
            <Link href="/anime">
              {t.popular_view_all}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </PillButton>
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
