"use client";

import { useState } from "react";
import Link from "next/link";
import { useDict, useLocale, useSetLocale } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { ANIME_GALLERY, handleImageError } from "./LandingData";

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

const LOCALE_LABELS = { ja: "日本語", zh: "中文", en: "English" } as const;
const LOCALE_CYCLE: Array<"ja" | "zh" | "en"> = ["ja", "zh", "en"];

export default function LandingPage({ onOpenAuth }: LandingPageProps) {
  const dict = useDict();
  const landing = dict.landing_hero.landing;
  const locale = useLocale();
  const setLocale = useSetLocale();
  const addRevealRef = useScrollReveal();
  const [heroFailed, setHeroFailed] = useState(false);

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-[var(--color-bg)]"
      style={{ fontFamily: "var(--app-font-body)" }}
      lang={locale}
    >
      {/* ── Header ── */}
      <header
        className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-5 py-4 sm:px-8"
        style={{
          background: "var(--color-bg)",
          borderBottom: "1px solid var(--color-border)",
          animation: "seichi-fade-down 0.5s ease-out",
        }}
      >
        <div
          className="flex items-baseline gap-3"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          <span className="text-[28px] font-bold tracking-[0.02em] text-[var(--color-fg)]">
            聖地巡礼
          </span>
          <span className="text-[12px] tracking-[2px] text-[var(--color-muted-fg)]">
            seichijunrei
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenAuth}
          className="rounded-lg px-5 py-2.5 text-[14px] font-medium text-[var(--color-fg)] transition-colors hover:bg-[var(--color-card)]"
          style={{ border: "1px solid var(--color-border)" }}
        >
          {landing.login}
        </button>
      </header>

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
              "linear-gradient(160deg, oklch(90% 0.03 220) 0%, var(--color-bg) 50%)",
          }}
        />

        <div className="relative z-[2] mx-auto flex min-h-[calc(100vh-72px)] max-w-[1200px] flex-col justify-center gap-12 px-5 sm:px-8 lg:flex-row lg:items-center lg:gap-16">
          {/* ── Left column: text ── */}
          <div
            className="flex max-w-[500px] shrink-0 flex-col"
            style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1)" }}
          >
            <h1
              className="font-[family-name:var(--app-font-display)] text-[clamp(48px,7vw,72px)] font-bold leading-[1.05] text-[var(--color-fg)]"
            >
              {landing.hero_title}
            </h1>

            <p
              className="mt-5 max-w-[38ch] text-[18px] leading-[1.6] text-[var(--color-muted-fg)]"
              style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.08s backwards" }}
            >
              {landing.hero_subtitle}
            </p>

            <button
              type="button"
              onClick={onOpenAuth}
              className="mt-8 inline-flex w-fit min-h-[52px] items-center gap-2.5 rounded-xl bg-[var(--color-primary)] px-8 text-[16px] font-semibold text-[var(--color-primary-fg)] transition-opacity hover:opacity-90"
              style={{
                fontFamily: "var(--app-font-body)",
                animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.16s backwards",
              }}
            >
              {landing.search_button}
              <span aria-hidden="true" className="text-[18px]">→</span>
            </button>

            {/* Stats — left-aligned, compact */}
            <div
              className="mt-12 flex gap-8"
              style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.24s backwards" }}
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
                    className="font-[family-name:var(--app-font-display)] text-[28px] font-bold tabular-nums text-[var(--color-fg)]"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {num}
                  </div>
                  <div className="text-[14px] text-[var(--color-muted-fg)]">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right column: comparison image ── */}
          {!heroFailed && (
            <div
              className="relative hidden min-w-0 flex-1 lg:block"
              style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.12s backwards" }}
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--color-card)]">
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
                    background: "oklch(98% 0.008 218 / 0.8)",
                    transform: "rotate(1.5deg)",
                  }}
                />
                {/* Tags */}
                <div
                  className="absolute bottom-4 left-4 rounded-lg px-3 py-1.5 text-[12px] font-semibold tracking-wide text-white uppercase"
                  style={{ background: "oklch(20% 0.02 238 / 0.7)", backdropFilter: "blur(8px)" }}
                >
                  Reality
                </div>
                <div
                  className="absolute bottom-4 right-4 rounded-lg px-3 py-1.5 text-[12px] font-semibold tracking-wide text-white uppercase"
                  style={{ background: "oklch(60% 0.148 240 / 0.85)", backdropFilter: "blur(8px)" }}
                >
                  Anime
                </div>
              </div>
              <p className="mt-3 text-[14px] text-[var(--color-muted-fg)]">
                <span className="font-[family-name:var(--app-font-display)] font-medium text-[var(--color-fg)]">
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
            className="seichi-reveal font-[family-name:var(--app-font-display)] text-[28px] font-bold text-[var(--color-fg)]"
          >
            {landing.gallery_title}
          </h2>
          <p
            ref={addRevealRef}
            className="seichi-reveal mt-2 text-[16px] leading-relaxed text-[var(--color-muted-fg)]"
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
              href={`/search?q=${encodeURIComponent(anime.title)}`}
              ref={addRevealRef}
              className={[
                "seichi-reveal-pop group relative overflow-hidden rounded-xl bg-[var(--color-card)]",
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
                  background: "linear-gradient(to top, oklch(15% 0.02 238 / 0.75) 0%, transparent 50%)",
                }}
              >
                <span
                  className={[
                    "font-[family-name:var(--app-font-display)] font-bold text-white",
                    i === 0 ? "text-[22px]" : "text-[15px]",
                  ].join(" ")}
                >
                  {anime.title}
                </span>
                <span
                  className={[
                    "mt-0.5 text-white/60",
                    i === 0 ? "text-[14px]" : "text-[12px]",
                  ].join(" ")}
                >
                  {anime.count}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--color-border)] px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between">
          <div className="flex items-baseline gap-2 text-[14px] text-[var(--color-muted-fg)]">
            <span className="font-[family-name:var(--app-font-display)] font-medium">
              聖地巡礼
            </span>
            <span className="opacity-40">·</span>
            <span>seichijunrei</span>
          </div>
          <button
            type="button"
            onClick={() => {
              const idx = LOCALE_CYCLE.indexOf(locale as "ja" | "zh" | "en");
              setLocale(LOCALE_CYCLE[(idx + 1) % LOCALE_CYCLE.length]);
            }}
            className="text-[14px] text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-fg)]"
          >
            {LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] ?? "English"}
          </button>
        </div>
      </footer>
    </div>
  );
}
