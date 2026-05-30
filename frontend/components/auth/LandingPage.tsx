"use client";

import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { useDict, useLocale } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { ANIME_GALLERY, handleImageError } from "./LandingData";
import SharedHeader from "../layout/SharedHeader";
import SharedFooter from "../layout/SharedFooter";
import { Button } from "@/components/ui/button";
import LandingHero from "./LandingHero";

interface LandingPageProps {
  onOpenAuth: (query?: string) => void;
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

      {/* ═══════ HERO ═══════ */}
      <LandingHero onOpenAuth={onOpenAuth} />

      {/* ═══════ GALLERY ═══════ */}
      <section className="bg-background px-5 pb-8 pt-12 sm:px-8">
        <div className="mx-auto max-w-[1100px]">
          <div className="mb-8 text-center">
            <h2
              ref={addRevealRef}
              className="seichi-reveal font-display text-[clamp(20px,3vw,26px)] font-bold text-foreground"
            >
              {t.gallery_title}
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
                  <div className="px-4 pb-2 pt-4">
                    <p className="font-display text-[13px] font-bold leading-snug text-foreground">{anime.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{anime.count}</p>
                  </div>
                  <div className="relative aspect-[4/3] overflow-hidden">
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
                        <p className="text-[10px] text-muted-foreground">{t.walking_route}</p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="mt-10 text-center">
            <Button type="dashed" size="middle" onClick={() => onOpenAuth()} className="gap-1.5">
              {t.gallery_all}
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      </section>

      {/* ═══════ 4-STEP ═══════ */}
      <section className="bg-card px-5 py-10 sm:px-8">
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

      {/* B2 / B3 sections will be inserted here */}

      <SharedFooter />
    </div>
  );
}
