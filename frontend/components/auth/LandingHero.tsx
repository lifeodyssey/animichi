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
    <section className="relative flex flex-1 items-center overflow-hidden bg-background px-5 py-8 sm:px-8">
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
          className="mt-10 lg:mt-24 lg:mx-0 [animation-delay:80ms]"
        />
      </div>
    </section>
  );
}

/**
 * RouteBackdrop — a single hand-drawn "travel route" sweeping across the lower
 * band of the hero: a fine dotted path with map pins that ends at a gold
 * destination pin. Warm brown (`--color-muted-fg`) so it reads as an intentional
 * journal route on the white page, not a competing accent — teal stays reserved
 * for interactive/foreground elements. One confident line beats two faint ones.
 */
function RouteBackdrop() {
  const pins: Array<{ x: number; y: number; gold?: boolean }> = [
    { x: 300, y: 602 },
    { x: 720, y: 548 },
    { x: 1150, y: 504, gold: true },
  ];
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1440 820"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M-40 548 C200 486 360 614 620 540 C880 468 1060 596 1500 486"
        stroke="var(--color-muted-fg)"
        strokeWidth="2.5"
        strokeDasharray="1.5 12"
        strokeLinecap="round"
        opacity="0.6"
      />
      <circle cx="120" cy="566" r="5" stroke="var(--color-muted-fg)" strokeWidth="2.5" opacity="0.55" />
      {pins.map(({ x, y, gold }, i) => (
        <g key={i} transform={`translate(${x - 9} ${y - 24})`} opacity={gold ? 0.92 : 0.6}>
          <path
            d="M9 0C4.03 0 0 4.03 0 9c0 6.75 9 15 9 15s9-8.25 9-15C18 4.03 13.97 0 9 0z"
            fill={gold ? "var(--color-cta)" : "var(--color-muted-fg)"}
          />
          <circle cx="9" cy="8.7" r="3.2" fill="var(--color-bg)" />
        </g>
      ))}
    </svg>
  );
}
