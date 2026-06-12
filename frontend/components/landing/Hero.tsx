"use client";

import { useDict } from "../../lib/i18n-context";
import HeroCopy from "./HeroCopy";
import RouteTrail from "./RouteTrail";
import ShowcaseCard from "./ShowcaseCard";

interface HeroProps {
  onOpenAuth: (query?: string) => void;
}

/**
 * Hero band — two top-aligned columns over the dotted RouteTrail doodle:
 * intro copy on the left, the tilted showcase card on the right with clear
 * air to the page edge (no bleed). The trail enters from the page's left
 * edge, threads the search-bar/chips gap, and resolves below the card.
 */
export default function Hero({ onOpenAuth }: HeroProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;

  return (
    <section className="relative flex-1 overflow-hidden bg-background">
      <RouteTrail />

      <div className="relative z-10 mx-auto grid w-full max-w-[1416px] grid-cols-1 gap-10 px-6 pb-10 pt-11 sm:px-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:items-start lg:gap-14">
        <HeroCopy onSearch={onOpenAuth} />

        <ShowcaseCard
          anime={{ src: "/images/landing/suga-shrine-anime-source.webp", alt: t.hero_anime_label }}
          real={{ src: "/images/landing/suga-shrine-reality-perspective-v2.webp", alt: t.hero_real_label }}
        />
      </div>
    </section>
  );
}
