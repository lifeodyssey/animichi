"use client";

import Link from "next/link";
import { Search, ChevronRight, MapPin } from "lucide-react";
import { ImageCompare } from "@/components/ui/image-compare";
import { useDict, useLocale } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { ANIME_GALLERY, handleImageError } from "./LandingData";
import SharedHeader from "../layout/SharedHeader";
import SharedFooter from "../layout/SharedFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LandingPageProps {
  onOpenAuth: () => void;
}

export default function LandingPage({ onOpenAuth }: LandingPageProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;
  const locale = useLocale();
  const addRevealRef = useScrollReveal();

  const steps = [
    { title: t.step1_title, desc: t.step1_desc, emoji: "🔍" },
    { title: t.step2_title, desc: t.step2_desc, emoji: "📍" },
    { title: t.step3_title, desc: t.step3_desc, emoji: "📋" },
    { title: t.step4_title, desc: t.step4_desc, emoji: "🌏" },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-background font-sans" lang={locale}>
      <SharedHeader onLogin={onOpenAuth} position="fixed" />

      {/* ═══════════ HERO ═══════════ */}
      <section className="relative overflow-hidden">
        {/* Background illustration — full bleed */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/landing/hero-background.png')" }}
        />
        <div className="absolute inset-0 bg-background/10" />

        {/* Hero content — full viewport height */}
        <div className="relative z-[2] mx-auto flex h-screen max-w-[1600px] items-center gap-6 px-6 pt-20 pb-8 sm:px-10 lg:px-14">

          {/* ── LEFT ~35%: text + search + CTA ── */}
          <div className="entrance-up flex w-full flex-col lg:w-[35%] lg:shrink-0">
            <h1 className="font-display text-[clamp(34px,5.5vw,52px)] font-bold leading-[1.15] text-foreground whitespace-pre-line">
              {t.hero_headline}
            </h1>
            <p
              className="entrance-up mt-5 text-[15px] leading-[1.8] text-foreground/75 whitespace-pre-line"
              style={{ animationDelay: "0.08s" }}
            >
              {t.hero_lead}
            </p>
            <div className="entrance-up mt-7" style={{ animationDelay: "0.14s" }}>
              <Input
                size="large"
                shadow
                prefix={<Search size={16} className="text-muted-foreground" />}
                placeholder={t.search_placeholder}
                onFocus={onOpenAuth}
                readOnly
              />
            </div>
            <div className="entrance-up mt-4" style={{ animationDelay: "0.20s" }}>
              <Button
                type="primary"
                size="large"
                block
                onClick={onOpenAuth}
                className="animal-btn-cta"
              >
                {t.search_button}
              </Button>
            </div>
          </div>

          {/* ── RIGHT ~60%: large card filling most of viewport height ── */}
          <div
            className="entrance-up relative hidden h-[calc(100vh-160px)] lg:block lg:flex-1"
            style={{ animationDelay: "0.10s" }}
          >
            {/* Main card — fills the entire right column height */}
            <div className="flex h-full flex-col overflow-hidden rounded-[24px] border-[3px] border-[var(--color-muted)] bg-[var(--color-card)] shadow-[var(--shadow-lg)]">

              {/* ▸ Comparison slider — takes ~70% of card height */}
              <div className="relative min-h-0 flex-[7]">
                {/* Location pill */}
                <div className="absolute left-4 top-4 z-30 flex items-center gap-1.5 rounded-full bg-card/90 px-3 py-1.5 text-[12px] font-semibold text-foreground shadow-sm backdrop-blur-sm">
                  <MapPin size={12} className="text-[var(--color-error-fg)]" />
                  君の名は。/ 須賀神社階段 · 新宿
                </div>

                <ImageCompare
                  leftSrc="/images/landing/hero-kimi-anitabi-real.jpg"
                  rightSrc="/images/landing/hero-kimi-banbi-reference.jpg"
                  leftAlt="動画中の場面"
                  rightAlt="真実の地点"
                  leftLabel={locale === "zh" ? "动画中的场景" : locale === "en" ? "Anime" : "動画"}
                  rightLabel={locale === "zh" ? "真实的地点" : locale === "en" ? "Real" : "実写"}
                  initialPosition={50}
                  className="h-full w-full cursor-ew-resize object-cover"
                />
              </div>

              {/* ▸ Route preview — takes ~30% of card height */}
              <div className="relative flex-[3] border-t-2 border-[var(--color-muted)] px-8 py-5">
                {/* Subtle pattern */}
                <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{
                  backgroundImage: "repeating-linear-gradient(45deg, var(--color-primary) 0, var(--color-primary) 1px, transparent 1px, transparent 18px)",
                  backgroundSize: "25px 25px",
                }} />

                {/* Title pill */}
                <div className="relative mx-auto mb-4 w-fit rounded-[var(--r-pill)] border-2 border-border bg-card px-6 py-2 shadow-sm">
                  <p className="text-center font-display text-[16px] font-bold text-foreground">
                    須賀神社階段 · 新宿
                  </p>
                </div>

                {/* Route: pin — dashed arc — pin */}
                <div className="relative flex items-start justify-between px-6">
                  {/* Start pin */}
                  <div className="z-10 flex flex-col items-center">
                    <svg width="36" height="46" viewBox="0 0 36 46" fill="none">
                      <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 28 18 28s18-14.5 18-28C36 8.06 27.94 0 18 0z" fill="var(--color-primary)" />
                      <circle cx="18" cy="17" r="7" fill="white" />
                    </svg>
                    <span className="-mt-1 text-[18px]">🌿</span>
                  </div>

                  {/* Curved dashed line */}
                  <svg className="absolute inset-x-16 top-5 h-10" viewBox="0 0 400 40" fill="none">
                    <path d="M0 30 C80 2, 160 38, 240 14 C320 -6, 380 24, 400 12" stroke="var(--color-primary)" strokeWidth="3.5" strokeDasharray="12 8" fill="none" opacity="0.4" strokeLinecap="round" />
                  </svg>

                  {/* End pin */}
                  <div className="z-10 flex flex-col items-center">
                    <svg width="36" height="46" viewBox="0 0 36 46" fill="none">
                      <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 28 18 28s18-14.5 18-28C36 8.06 27.94 0 18 0z" fill="var(--color-error-fg)" />
                      <circle cx="18" cy="17" r="7" fill="white" />
                    </svg>
                    <span className="-mt-1 text-[18px]">🌿</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Wave divider */}
        <div className="absolute inset-x-0 bottom-0 z-[3]">
          <svg viewBox="0 0 1440 120" fill="none" className="block w-full" preserveAspectRatio="none">
            <path d="M0 70C180 110 360 30 540 60C720 90 900 35 1080 60C1260 85 1380 45 1440 65V120H0V70Z" fill="var(--color-bg)" />
          </svg>
        </div>
      </section>

      {/* ═══════════ GALLERY ═══════════ */}
      <section className="bg-background px-5 pb-8 pt-12 sm:px-8">
        <div className="mx-auto max-w-[1100px]">
          <div className="mb-8 text-center">
            <h2
              ref={addRevealRef}
              className="seichi-reveal font-display text-[clamp(20px,3vw,26px)] font-bold text-foreground"
            >
              ⛩ {t.gallery_title}
            </h2>
            <p
              ref={addRevealRef}
              className="seichi-reveal mx-auto mt-2 max-w-[440px] text-[13px] leading-relaxed text-muted-foreground"
            >
              {t.gallery_sub}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {ANIME_GALLERY.slice(0, 4).map((anime, i) => {
              const location = anime.count.split("·")[1]?.trim() ?? "";
              return (
                <Link
                  key={anime.bangumiId}
                  href={`/anime/${anime.bangumiId}`}
                  ref={addRevealRef}
                  className="seichi-reveal-pop group overflow-hidden rounded-2xl border-2 border-border bg-card transition-all duration-300 ease-[var(--ease-animal)] hover:-translate-y-1.5 hover:shadow-[var(--shadow-card)]"
                  style={{ animationDelay: `${i * 0.06}s` }}
                >
                  <div className="px-4 pt-4 pb-2">
                    <p className="font-display text-[13px] font-bold leading-snug text-foreground">{anime.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{anime.count}</p>
                  </div>
                  <div className="relative overflow-hidden aspect-[4/3]">
                    <img
                      src={`/images/bangumi/${anime.bangumiId}.jpg`}
                      alt={anime.title}
                      loading={i < 2 ? "eager" : "lazy"}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      onError={handleImageError}
                    />
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-start gap-1.5">
                      <MapPin size={13} className="mt-px shrink-0 text-[var(--color-error-fg)]" />
                      <div>
                        <p className="text-[11px] font-medium text-foreground">{location}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {locale === "zh" ? "步行路线" : locale === "en" ? "Walking route" : "徒歩ルート"}
                        </p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="mt-10 text-center">
            <Button type="dashed" size="middle" onClick={onOpenAuth} className="gap-1.5">
              {t.gallery_all}
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      </section>

      {/* ═══════════ 4-STEP ═══════════ */}
      <section className="bg-[var(--color-card)] px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-[960px] flex-wrap justify-center gap-8 sm:gap-10">
          {steps.map((step, i) => (
            <div
              key={i}
              ref={addRevealRef}
              className="seichi-reveal flex items-center gap-3"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <span className="text-[40px] leading-none" role="img" aria-hidden="true">
                {step.emoji}
              </span>
              <div>
                <h3 className="text-[13px] font-bold text-foreground">{step.title}</h3>
                <p className="mt-0.5 whitespace-pre-line text-[11px] leading-snug text-muted-foreground">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <SharedFooter />
    </div>
  );
}
