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
    <section className="relative min-h-screen overflow-hidden">
      {/* ── Full-bleed BeforeAfter base layer ── */}
      <BeforeAfter
        leftSrc="/images/landing/hero-kimi-anitabi-real.jpg"
        rightSrc="/images/landing/hero-kimi-banbi-reference.jpg"
        leftAlt={t.hero_anime_label}
        rightAlt={t.hero_real_label}
        leftLabel={t.hero_anime_label}
        rightLabel={t.hero_real_label}
        draggable
        className="absolute inset-0 h-full w-full rounded-none border-0"
      />

      {/* ── Dark overlay gradient — bottom emphasis ── */}
      <div
        className="hero-vignette absolute inset-0 pointer-events-none"
        aria-hidden="true"
      />

      {/* ── Floating content layer ── */}
      <div className="relative z-10 flex min-h-screen flex-col justify-end pb-10 px-5 lg:flex-row lg:items-end lg:justify-between lg:pb-14 lg:px-12 xl:px-16">

        {/* Left: organic parchment panel */}
        <HeroParchmentPanel
          headline={t.hero_headline}
          lead={t.hero_lead}
          authHint={t.hero_auth_hint}
        />

        {/* Right: search card with fox */}
        <div className="relative mt-5 w-full lg:mt-0 lg:w-auto lg:min-w-[380px] lg:max-w-[440px]">
          {/* Fox peeks above the card */}
          <FoxGuide
            pose="welcome"
            size="md"
            surface="welcome"
            className="-top-14 right-4 lg:-top-16 lg:right-6"
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

      {/* ── Wave divider at bottom ── */}
      <div className="absolute inset-x-0 bottom-0 z-20 pointer-events-none">
        <svg
          viewBox="0 0 1440 80"
          fill="none"
          className="block w-full"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 50C200 80 400 20 640 48C880 76 1100 28 1300 50C1380 60 1420 55 1440 52V80H0V50Z"
            fill="var(--color-bg)"
          />
        </svg>
      </div>
    </section>
  );
}
