"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import ToriiIcon from "@/components/icons/ToriiIcon";
import { SearchBar } from "@/components/ui/search-bar";
import { Chip } from "@/components/ui/chip";
import { useRecentRoute } from "@/hooks/useRecentRoute";
import { useDict } from "../../lib/i18n-context";

interface HeroIntroProps {
  /** Fired when the user submits a non-empty query. */
  onSearch: (query: string) => void;
  /** Fired when the user taps an example chip. */
  onChip: (example: string) => void;
}

/** Marker-dot tones for the example chips, cycled across the row. */
const CHIP_TONES = ["leaf", "teal", "gold"] as const;

/**
 * Left hero column — the airy intro lifted straight from the blueprint:
 * a torii eyebrow, a large serif headline, a lead line, the combined
 * {@link SearchBar} with its pumpkin CTA, and example {@link Chip}s. No card
 * framing, so the right photo card carries the visual weight.
 */
export default function HeroIntro({ onSearch, onChip }: HeroIntroProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const recent = useRecentRoute();

  // "/" focuses the search from anywhere on the page — a power-user accelerator
  // that stays out of the way while the visitor is typing in any field.
  useEffect(() => {
    function onSlash(e: KeyboardEvent) {
      if (e.key !== "/" || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onSlash);
    return () => document.removeEventListener("keydown", onSlash);
  }, []);

  const submit = useCallback(() => {
    const q = query.trim();
    if (q) onSearch(q);
  }, [query, onSearch]);

  const tapChip = useCallback(
    (example: string) => {
      setQuery(example);
      onChip(example);
    },
    [onChip],
  );

  const examples = ((t.hero_examples ?? []) as string[]).slice(0, 3);

  return (
    <div className="entrance-up">
      <span className="inline-flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-[0.16em] text-explore">
        <ToriiIcon size={16} />
        Anime travel journal
      </span>

      <h1 className="mt-6 max-w-[20ch] font-display text-[clamp(38px,4.6vw,56px)] font-bold leading-[1.05] text-fg-heading text-balance">
        {t.hero_headline}
      </h1>

      <p className="mt-4 max-w-[480px] text-[clamp(15px,1.3vw,17px)] leading-[1.65] text-muted-foreground">
        {t.hero_lead}
      </p>

      <SearchBar
        value={query}
        onValueChange={setQuery}
        onSubmit={submit}
        placeholder={t.search_placeholder}
        ctaLabel={t.search_button}
        className="mt-8 max-w-[480px]"
        inputRef={inputRef}
      />

      {recent ? (
        <p className="mt-5">
          <Link
            href={`/anime/${recent.bangumiId}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold underline-offset-4 transition-colors hover:underline"
            data-testid="hero-continue"
          >
            {/* Teal lives on a span, not the <a>: a global `a { color: inherit }`
                (globals.css) would otherwise override text-primary on the anchor. */}
            <span className="inline-flex items-center gap-1.5 text-primary">
              <RotateCcw size={14} aria-hidden="true" />
              {t.hero_continue}
            </span>
            <span className="text-fg">· {recent.title}</span>
          </Link>
        </p>
      ) : null}

      <div className="mt-6">
        <p className="text-[12px] font-semibold text-muted-foreground">Try an example</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {examples.map((ex, i) => (
            <Chip
              key={ex}
              tone={CHIP_TONES[i % 3]}
              onClick={() => tapChip(ex)}
              data-testid={`example-chip-${ex}`}
            >
              {ex}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
