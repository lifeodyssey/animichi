"use client";

import { useState } from "react";
import Link from "next/link";
import { useDict, useLocale } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { ANIME_GALLERY, handleImageError } from "./LandingData";
import SharedHeader from "../layout/SharedHeader";
import SharedFooter from "../layout/SharedFooter";
import { Button } from "@/components/ui/button";

interface LandingPageProps {
  onOpenAuth: () => void;
}

/* ── Type scale (Perfect Fourth 1.333) ──────────────────────────────── */
// xs: 12px — captions, legal
// sm: 14px — secondary, metadata
// base: 16px — body
// lg: 21px — lead text
// xl: 28px — section headings
// 2xl: 38px — display (mobile)
// 3xl: clamp(48px, 7vw, 72px) — hero display

export default function LandingPage({ onOpenAuth }: LandingPageProps) {
  const dict = useDict();
  const landing = dict.landing_hero.landing;
  const locale = useLocale();
  const addRevealRef = useScrollReveal();
  const [heroFailed, setHeroFailed] = useState(false);

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-background font-sans"
      lang={locale}
    >
      <SharedHeader onLogin={onOpenAuth} position="fixed" />

      {/* ── Hero ── */}
      <section
        data-testid="hero-section"
        className="relative overflow-hidden pt-[72px]"
      >
        {/* Background wash */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(160deg, var(--color-gradient-soft) 0%, var(--color-bg) 50%)",
          }}
        />

        <div className="relative z-[2] mx-auto flex min-h-[calc(100vh-72px)] max-w-[1200px] flex-col justify-center gap-12 px-5 sm:px-8 lg:flex-row lg:items-center lg:gap-16">
          {/* ── Left column: text ── */}
          <div
            className="entrance-up flex max-w-[500px] shrink-0 flex-col"
          >
            <h1
              className="font-display text-[clamp(48px,7vw,72px)] font-bold leading-[1.05] text-foreground"
            >
              {landing.hero_title}
            </h1>

            <p
              className="entrance-up mt-5 max-w-[38ch] text-lg leading-[1.6] text-muted-foreground"
              style={{ animationDelay: "0.08s" }}
            >
              {landing.hero_subtitle}
            </p>

            <Button
              variant="primary"
              size="lg"
              onClick={onOpenAuth}
              className="entrance-up mt-8 w-fit gap-2.5"
              style={{ animationDelay: "0.16s" }}
            >
              {landing.search_button}
              <span aria-hidden="true" className="text-lg">→</span>
            </Button>

            {/* Stats — left-aligned, compact */}
            <div
              className="entrance-up mt-12 flex gap-8"
              style={{ animationDelay: "0.24s" }}
            >
              {(
                [
                  ["2,400+", landing.stats_spots],
                  ["180+", landing.stats_anime],
                  ["47", landing.stats_prefectures],
                ] as const
              ).map(([num, label]) => (
                <div key={num}>
                  <div
                    className="font-display text-[28px] font-bold tabular-nums text-foreground"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {num}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right column: comparison image ── */}
          {!heroFailed && (
            <div
              className="entrance-up relative hidden min-w-0 flex-1 lg:block"
              style={{ animationDelay: "0.12s" }}
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-card">
                <img
                  src="/images/hero-reality.jpg"
                  alt="実写 — Reality"
                  className="absolute inset-0 h-full w-full object-cover"
                  onError={() => setHeroFailed(true)}
                />
                <div
                  className="absolute inset-0"
                  style={{ clipPath: "polygon(42% 0, 100% 0, 100% 100%, 58% 100%)" }}
                >
                  <img
                    src="/images/hero-anime.jpg"
                    alt="アニメ — Anime"
                    className="h-full w-full object-cover"
                    onError={() => setHeroFailed(true)}
                  />
                </div>
                {/* Diagonal divider */}
                <div
                  className="pointer-events-none absolute inset-y-0"
                  style={{
                    left: "50%",
                    width: "2px",
                    background: "rgba(255, 255, 255, 0.8)",
                    transform: "rotate(1.5deg)",
                  }}
                />
                {/* Tags */}
                <div
                  className="absolute bottom-4 left-4 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide text-white uppercase"
                  style={{ background: "var(--color-overlay)", backdropFilter: "blur(8px)" }}
                >
                  Reality
                </div>
                <div
                  className="absolute bottom-4 right-4 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide text-white uppercase"
                  style={{ background: "var(--color-overlay)", backdropFilter: "blur(8px)" }}
                >
                  Anime
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                <span className="font-display font-medium text-foreground">
                  君の名は。
                </span>
                {" "}— 須賀神社 · 新宿区
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Gallery ── */}
      <section
        data-testid="gallery-section"
        className="mx-auto max-w-[1200px] px-5 pb-24 pt-16 sm:px-8 sm:pt-24"
      >
        <div className="mb-10 max-w-[480px]">
          <h2
            ref={addRevealRef}
            className="seichi-reveal font-display text-[28px] font-bold text-foreground"
          >
            {landing.gallery_title}
          </h2>
          <p
            ref={addRevealRef}
            className="seichi-reveal mt-2 text-base leading-relaxed text-muted-foreground"
          >
            {landing.gallery_sub}
          </p>
        </div>

        {/*
          Masonry-style grid for portrait covers:
          - First card is hero-sized (spans 2 cols, taller)
          - Others are uniform portrait cards
          - 3 cols on desktop, 2 on mobile
        */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
          {ANIME_GALLERY.map((anime, i) => (
            <Link
              key={anime.bangumiId}
              href={`/anime/${anime.bangumiId}`}
              ref={addRevealRef}
              className={[
                "seichi-reveal-pop group relative overflow-hidden rounded-xl bg-card shadow-[var(--shadow-card)] transition-all duration-300 ease-[var(--ease-animal)] hover:-translate-y-1 hover:shadow-[var(--shadow-card-hover)]",
                i === 0 ? "col-span-2 row-span-2" : "",
              ].join(" ")}
              style={{
                aspectRatio: i === 0 ? "3/4" : "2/3",
                animationDelay: `${i * 0.04}s`,
              }}
            >
              <img
                src={`/images/bangumi/${anime.bangumiId}.jpg`}
                alt={anime.title}
                loading={i < 4 ? "eager" : "lazy"}
                className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04]"
                style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
                onError={handleImageError}
              />
              {/* Gradient scrim */}
              <div
                className="absolute inset-0 flex flex-col justify-end p-4"
                style={{
                  background: "linear-gradient(to top, var(--color-overlay-image) 0%, transparent 50%)",
                }}
              >
                <span
                  className={[
                    "font-display font-bold text-white",
                    i === 0 ? "text-2xl" : "text-base",
                  ].join(" ")}
                >
                  {anime.title}
                </span>
                <span
                  className={[
                    "mt-0.5 text-white/60",
                    i === 0 ? "text-sm" : "text-xs",
                  ].join(" ")}
                >
                  {anime.count}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <SharedFooter />
    </div>
  );
}
