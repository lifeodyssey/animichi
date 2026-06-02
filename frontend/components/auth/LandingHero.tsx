"use client";

import { useState, useCallback } from "react";
import { Search, Navigation, MapPin } from "lucide-react";
import BeforeAfter from "@/components/generative/BeforeAfter";
import FoxGuide from "@/components/generative/FoxGuide";
import Stamp from "@/components/landing/decor/Stamp";
import ToriiIcon from "@/components/icons/ToriiIcon";
import { useDict } from "../../lib/i18n-context";

interface LandingHeroProps {
  onOpenAuth: (query?: string) => void;
}

const CHIP_DOT = ["#7fae6b", "#19c8b9", "#f0b429"];

/**
 * Hero — faithful build of the locked blueprint (variant-F): a planning-desk
 * route backdrop, a left column led by a large serif headline + combined search,
 * and a large tilted journal photo of the anime↔real comparison with corner
 * pill labels, a place caption, a pressed shrine stamp, and the peeking fox.
 * Library color tokens throughout.
 */
export default function LandingHero({ onOpenAuth }: LandingHeroProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;
  const [query, setQuery] = useState("");

  const search = useCallback(
    (q: string) => q.trim() && onOpenAuth(q.trim()),
    [onOpenAuth],
  );
  const chip = useCallback(
    (ex: string) => {
      setQuery(ex);
      onOpenAuth(ex);
    },
    [onOpenAuth],
  );

  const examples = ((t.hero_examples ?? []) as string[]).slice(0, 3);

  return (
    <section className="relative flex min-h-[calc(100vh-72px)] items-center overflow-hidden bg-[var(--animal-bg-color-content)] px-5 py-12 sm:px-8">
      <RouteBackdrop />

      <div className="relative z-10 mx-auto grid w-full max-w-[1240px] items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
        {/* ── Left ── */}
        <div className="entrance-up">
          <span className="inline-flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-[0.16em] text-explore">
            <ToriiIcon size={16} />
            Anime travel journal
          </span>

          <h1 className="mt-5 font-display text-[clamp(36px,4.6vw,56px)] font-bold leading-[1.06] text-fg-heading text-balance">
            {t.hero_headline}
          </h1>

          <p className="mt-5 max-w-[42ch] text-[clamp(15px,1.3vw,17px)] leading-[1.65] text-muted-foreground">
            {t.hero_lead}
          </p>

          {/* combined search bar */}
          <div className="mt-8 flex max-w-[500px] items-center gap-1.5 rounded-[50px] border border-border bg-background p-1.5 shadow-3d-sm">
            <Search size={17} className="ml-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(query)}
              placeholder={t.search_placeholder}
              className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="button"
              onClick={() => search(query)}
              className="btn-explore flex shrink-0 items-center gap-2 px-5 py-2.5 text-[14px] font-bold"
            >
              <Navigation size={15} aria-hidden="true" />
              <span className="hidden sm:inline">{t.search_button}</span>
            </button>
          </div>

          {/* example chips */}
          <div className="mt-5">
            <p className="text-[12px] font-semibold text-muted-foreground">Try an example</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {examples.map((ex, i) => (
                <button
                  key={ex}
                  type="button"
                  data-testid={`example-chip-${ex}`}
                  onClick={() => chip(ex)}
                  className="flex items-center gap-2 rounded-[50px] border border-border bg-card px-3.5 py-2 text-[13px] font-semibold text-fg shadow-sm transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-explore"
                >
                  <span className="size-2.5 rounded-full" style={{ background: CHIP_DOT[i % 3] }} aria-hidden="true" />
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: large journal photo ── */}
        <div className="entrance-up relative mx-auto w-full max-w-[560px] lg:mx-0" style={{ animationDelay: "0.08s" }}>
          <FoxGuide pose="welcome" size="md" surface="welcome" className="-top-[4.5rem] right-2 z-20" />

          <div data-testid="route-preview" className="paper-surface relative z-10 rotate-[1.8deg] rounded-[22px] p-4">
            <div className="relative overflow-hidden rounded-[16px] border border-border">
              <BeforeAfter
                leftSrc="/images/landing/suga-shrine-anime-source.webp"
                rightSrc="/images/landing/suga-shrine-reality-perspective-v2.webp"
                leftAlt={t.hero_anime_label}
                rightAlt={t.hero_real_label}
                draggable
                className="!aspect-[16/11] h-auto w-full rounded-none border-0"
              />
              <CornerLabel side="left" dot="#7fae6b" text={t.hero_anime_label} />
              <CornerLabel side="right" dot="#19c8b9" text={t.hero_real_label} />
            </div>

            {/* place caption */}
            <div className="flex items-center gap-2.5 px-2 pb-1 pt-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12">
                <MapPin size={15} className="text-primary" aria-hidden="true" />
              </span>
              <span className="leading-tight">
                <span className="block font-display text-[15px] font-bold text-fg-heading">
                  {t.hero_location_label ?? "須賀神社 階段"}
                </span>
                <span className="block text-[12px] font-medium text-muted-foreground">
                  {t.hero_route_preview ?? "Shinjuku, Tokyo"}
                </span>
              </span>
            </div>
          </div>

          <Stamp ringText="聖地巡礼" glyph="torii" size={80} rotate={-12} className="absolute -bottom-6 -right-5 z-20" />
        </div>
      </div>
    </section>
  );
}

function CornerLabel({ side, dot, text }: { side: "left" | "right"; dot: string; text: string }) {
  return (
    <span
      className={`absolute top-3 z-10 inline-flex items-center gap-1.5 rounded-[50px] bg-card/95 px-2.5 py-1 text-[11px] font-bold text-fg shadow-sm backdrop-blur-sm ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      <span className="size-2 rounded-full" style={{ background: dot }} aria-hidden="true" />
      {text}
    </span>
  );
}

function RouteBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 1440 820"
      fill="none"
      aria-hidden="true"
    >
      <path d="M-20 150 C200 90 330 230 540 185 C780 132 940 280 1200 220" stroke="var(--color-primary)" strokeWidth="2" strokeDasharray="2 11" strokeLinecap="round" opacity="0.55" />
      <path d="M-20 660 C260 720 430 580 700 640 C960 698 1100 560 1340 620" stroke="var(--color-primary)" strokeWidth="2" strokeDasharray="2 11" strokeLinecap="round" opacity="0.4" />
      {[[120, 250], [300, 110], [430, 690], [760, 600], [1180, 250]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x - 7} ${y - 18})`} opacity="0.6">
          <path d="M7 0C3.13 0 0 3.13 0 7c0 5.25 7 11 7 11s7-5.75 7-11C14 3.13 10.87 0 7 0z" fill={i % 2 ? "var(--color-marker-active)" : "var(--color-primary)"} />
          <circle cx="7" cy="6.8" r="2.6" fill="var(--animal-bg-color-content)" />
        </g>
      ))}
    </svg>
  );
}
