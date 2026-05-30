"use client";

import { useState, useCallback } from "react";
import BeforeAfter from "@/components/generative/BeforeAfter";
import FoxGuide from "@/components/generative/FoxGuide";
import { useDict } from "../../lib/i18n-context";
import HeroSearchCard from "./HeroSearchCard";
import HeroParchmentPanel from "./HeroParchmentPanel";

interface LandingHeroProps {
  onOpenAuth: (query?: string) => void;
}

export default function LandingHero({ onOpenAuth }: LandingHeroProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;

  const [query, setQuery] = useState("");

  const handleSearch = useCallback(
    (q: string) => {
      if (!q.trim()) return;
      onOpenAuth(q.trim());
    },
    [onOpenAuth],
  );

  const handleChip = useCallback(
    (example: string) => {
      setQuery(example);
      onOpenAuth(example);
    },
    [onOpenAuth],
  );

  const examples = (t.hero_examples ?? []) as string[];

  return (
    <section className="relative overflow-hidden">
      {/* Wave divider */}
      <div className="absolute inset-x-0 bottom-0 z-[3]">
        <svg viewBox="0 0 1440 120" fill="none" className="block w-full" preserveAspectRatio="none">
          <path d="M0 70C180 110 360 30 540 60C720 90 900 35 1080 60C1260 85 1380 45 1440 65V120H0V70Z" fill="var(--color-bg)" />
        </svg>
      </div>

      <div className="relative z-[2] mx-auto flex min-h-screen max-w-[1600px] flex-col gap-0 pt-16 lg:flex-row">

        {/* ── LEFT: parchment panel ── */}
        <HeroParchmentPanel headline={t.hero_headline} lead={t.hero_lead} />

        {/* ── RIGHT: BeforeAfter + floating search card ── */}
        <div className="relative flex-1">
          {/* Full-bleed BeforeAfter */}
          <BeforeAfter
            leftSrc="/images/landing/hero-kimi-anitabi-real.jpg"
            rightSrc="/images/landing/hero-kimi-banbi-reference.jpg"
            leftAlt={t.hero_anime_label}
            rightAlt={t.hero_real_label}
            leftLabel={t.hero_anime_label}
            rightLabel={t.hero_real_label}
            draggable
            className="h-full min-h-[60vw] w-full rounded-none border-0 lg:min-h-screen"
          />

          {/* Floating search card — bottom-left of right panel */}
          <div className="absolute bottom-16 left-6 right-6 z-20 lg:bottom-20 lg:left-8 lg:right-8 lg:max-w-[440px]">
            {/* Fox peeks from behind the card */}
            <FoxGuide
              pose="welcome"
              size="sm"
              surface="welcome"
              className="-top-12 right-4 lg:-top-14 lg:right-6"
            />

            <HeroSearchCard
              query={query}
              onQueryChange={setQuery}
              onSearch={handleSearch}
              examples={examples}
              onChip={handleChip}
              placeholder={t.search_placeholder}
              ctaLabel={t.search_button}
              nearbyLabel={t.hero_nearby}
              authHint={t.hero_auth_hint}
              locationLabel={t.hero_location_label}
              routePreviewLabel={t.hero_route_preview}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
