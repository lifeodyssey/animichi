"use client";

import { useState } from "react";
import ToriiIcon from "@/components/icons/ToriiIcon";
import { Chip } from "@/components/ui/chip";
import { SearchBar } from "@/components/ui/search-bar";
import { useDict } from "../../lib/i18n-context";

interface HeroCopyProps {
  /** Fired with the submitted query or a tapped example chip. */
  onSearch: (query: string) => void;
}

/** Example chips cycle the NookPhone pastel tiles (DESIGN.md accent tier). */
const TILE_TONES = ["nook-teal", "nook-yellow", "nook-pink"] as const;

/**
 * HeroCopy — the left column: brand-red eyebrow, the three-line serif
 * headline, the lead, the chunky search pill with its pumpkin CTA, and the
 * "Try an example" chips row. The tall gap between the search bar and the
 * chips is deliberate — the dotted RouteTrail threads through it.
 */
export default function HeroCopy({ onSearch }: HeroCopyProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;
  const [query, setQuery] = useState("");
  const examples = ((t.hero_examples ?? []) as string[]).slice(0, 3);

  const submit = () => {
    const q = query.trim();
    if (q) onSearch(q);
  };

  const tapChip = (example: string) => {
    setQuery(example);
    onSearch(example);
  };

  return (
    <div className="entrance-up">
      <span className="inline-flex items-center gap-2 text-[12.5px] font-extrabold uppercase tracking-[0.18em] text-brand-text">
        <ToriiIcon size={15} />
        {t.hero_eyebrow}
      </span>

      <h1 className="mt-8 max-w-[20ch] font-sans text-[clamp(44px,4.3vw,62px)] font-extrabold leading-[1.12] tracking-[-0.005em] text-fg-heading text-balance">
        {t.hero_headline}
      </h1>

      <p className="mt-5 max-w-[440px] text-[17px] leading-[1.6] text-fg">{t.hero_lead}</p>

      <SearchBar
        value={query}
        onValueChange={setQuery}
        onSubmit={submit}
        placeholder={t.search_placeholder}
        ctaLabel={t.search_button}
        className="mt-8 max-w-[545px]"
      />

      <div className="mt-16">
        <p className="text-[12px] font-semibold text-fg">{t.hero_try_example}</p>
        <div className="mt-2.5 flex flex-wrap gap-2.5">
          {examples.map((ex, i) => (
            <Chip key={ex} tone={TILE_TONES[i % TILE_TONES.length]} onClick={() => tapChip(ex)}>
              {ex}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
