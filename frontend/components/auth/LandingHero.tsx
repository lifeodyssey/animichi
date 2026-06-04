"use client";

import HeroIntro from "./HeroIntro";
import HeroSceneCard from "./HeroSceneCard";
import { useDict } from "../../lib/i18n-context";

interface LandingHeroProps {
  onOpenAuth: (query?: string) => void;
}

/**
 * Hero — the locked blueprint (variant-F) composed from two focused pieces:
 * `HeroIntro` (the airy left column: eyebrow, serif headline, search, chips) and
 * `HeroSceneCard` (the tilted anime↔real journal photo card), laid over a dashed
 * route backdrop. Library color tokens throughout.
 */
export default function LandingHero({ onOpenAuth }: LandingHeroProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;

  return (
    <section className="relative flex min-h-[calc(100vh-72px)] items-center overflow-hidden bg-[var(--animal-bg-color-content)] px-5 py-12 sm:px-8">
      <RouteBackdrop />

      <div className="relative z-10 mx-auto grid w-full max-w-[1240px] items-start gap-10 lg:grid-cols-[1.04fr_0.96fr] lg:gap-16">
        <HeroIntro onSearch={onOpenAuth} onChip={onOpenAuth} />

        <HeroSceneCard
          animeSrc="/images/landing/suga-shrine-anime-source.webp"
          realSrc="/images/landing/suga-shrine-reality-perspective-v2.webp"
          animeLabel={t.hero_anime_label}
          realLabel={t.hero_real_label}
          locationName={t.hero_location_label ?? "須賀神社 階段"}
          locationArea={t.hero_route_preview ?? "Shinjuku, Tokyo"}
          className="lg:mx-0 [animation-delay:80ms]"
        />
      </div>
    </section>
  );
}

/**
 * RouteBackdrop — faint hand-drawn "route" texture. Kept warm-neutral and low
 * opacity on purpose: teal is reserved for interactive/foreground elements, so
 * the backdrop reads as quiet paper texture, not a competing accent layer. Two
 * gentle dashed curves sit in the lower band (clear of the headline) with a few
 * matching pins, all on one dash cadence.
 */
function RouteBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1440 820"
      fill="none"
      aria-hidden="true"
    >
      <path d="M-20 470 C240 410 380 540 620 488 C880 432 1020 560 1300 500" stroke="var(--color-border)" strokeWidth="2" strokeDasharray="2 9" strokeLinecap="round" opacity="0.4" />
      <path d="M-20 690 C260 740 430 600 700 660 C960 716 1100 580 1340 640" stroke="var(--color-border)" strokeWidth="2" strokeDasharray="2 9" strokeLinecap="round" opacity="0.28" />
      {[[380, 503], [760, 650], [1200, 498]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x - 7} ${y - 18})`} opacity="0.38">
          <path d="M7 0C3.13 0 0 3.13 0 7c0 5.25 7 11 7 11s7-5.75 7-11C14 3.13 10.87 0 7 0z" fill="var(--color-border)" />
          <circle cx="7" cy="6.8" r="2.6" fill="var(--animal-bg-color-content)" />
        </g>
      ))}
    </svg>
  );
}
