"use client";

import { Search, GitCompareArrows, ListChecks, Footprints } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import RouteLine from "@/components/landing/decor/RouteLine";
import Stamp from "@/components/landing/decor/Stamp";
import LeafSprig from "@/components/landing/decor/LeafSprig";
import FoxGuide from "@/components/generative/FoxGuide";
import { useDict } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";

interface Step {
  icon: LucideIcon;
  tint: string;
  title: string;
  desc: string;
  preview: React.ReactNode;
}

// ── Mini previews: evocative, not functional ────────────────────────────────

function MiniSearch() {
  return (
    <div className="flex items-center gap-2 rounded-[50px] border border-border bg-background px-3 py-2 shadow-3d-sm">
      <Search size={13} className="text-primary" aria-hidden="true" />
      <span className="text-[12px] text-muted-foreground">君の名は。</span>
    </div>
  );
}

function MiniCompare() {
  return (
    <div className="relative flex h-20 overflow-hidden rounded-[12px] border border-border">
      <img
        src="/images/landing/suga-shrine-anime-source.webp"
        alt=""
        className="h-full w-1/2 object-cover"
      />
      <img
        src="/images/landing/suga-shrine-reality-perspective-v2.webp"
        alt=""
        className="h-full w-1/2 border-l-2 border-background object-cover"
      />
      <span className="absolute left-1.5 top-1.5 rounded-[6px] bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
        Anime
      </span>
      <span className="absolute right-1.5 top-1.5 rounded-[6px] bg-fg/80 px-1.5 py-0.5 text-[9px] font-bold text-background">
        Real
      </span>
    </div>
  );
}

function MiniChecklist() {
  return (
    <div className="flex flex-col gap-1.5 rounded-[12px] border border-border bg-background p-2.5">
      {["須賀神社 階段", "四ツ谷駅", "新宿御苑"].map((s, i) => (
        <span key={s} className="flex items-center gap-2 text-[11px] text-fg">
          <span
            className={`flex size-3.5 items-center justify-center rounded-[4px] ${
              i < 2 ? "bg-primary text-primary-foreground" : "border border-border"
            }`}
          >
            {i < 2 ? (
              <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 6l2.5 2.5L10 3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </span>
          {s}
        </span>
      ))}
    </div>
  );
}

function MiniMap() {
  return (
    <div className="relative h-20 overflow-hidden rounded-[12px] border border-border bg-walk-bg/50">
      <div className="absolute inset-x-2 top-1/2 -translate-y-1/2">
        <RouteLine stops={1} />
      </div>
    </div>
  );
}

// ── Step card ────────────────────────────────────────────────────────────────

function StepCard({
  step,
  index,
  addRevealRef,
}: {
  step: Step;
  index: number;
  addRevealRef: (el: HTMLElement | null) => void;
}) {
  const Icon = step.icon;
  return (
    <li
      ref={addRevealRef}
      className="seichi-reveal flex flex-col gap-3"
      style={{ animationDelay: `${index * 0.09}s` }}
    >
      <div className="relative z-10 flex items-center gap-3">
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-[16px] text-white shadow-md"
          style={{ background: step.tint }}
        >
          <Icon size={22} aria-hidden="true" />
        </span>
        <span className="font-mono text-[12px] font-bold text-muted-foreground">
          0{index + 1}
        </span>
      </div>
      <div>
        <h3 className="font-display text-[16px] font-bold leading-snug text-fg-heading">
          {step.title}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {step.desc}
        </p>
      </div>
      <div className="mt-1">{step.preview}</div>
    </li>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export function LandingHowItWorks() {
  const dict = useDict();
  const t = dict.landing_hero.landing;
  const addRevealRef = useScrollReveal();

  const steps: Step[] = [
    { icon: Search, tint: "var(--color-primary)", title: t.hiw_step1_title, desc: t.hiw_step1_desc, preview: <MiniSearch /> },
    { icon: GitCompareArrows, tint: "var(--color-explore)", title: t.hiw_step2_title, desc: t.hiw_step2_desc, preview: <MiniCompare /> },
    { icon: ListChecks, tint: "var(--color-cta)", title: t.hiw_step3_title, desc: t.hiw_step3_desc, preview: <MiniChecklist /> },
    { icon: Footprints, tint: "#7fae6b", title: t.hiw_step4_title, desc: t.hiw_step4_desc, preview: <MiniMap /> },
  ];

  return (
    <section className="relative overflow-hidden bg-card px-5 py-16 sm:px-8 sm:py-20">
      {/* Pressed decorations */}
      <Stamp ringText="次の一歩" glyph="footprint" size={70} rotate={-10} className="absolute left-6 top-8 hidden lg:block" />
      <Stamp ringText="歩いてこそ" glyph="compass" size={66} rotate={8} className="absolute right-8 top-10 hidden lg:block" />
      <LeafSprig size={34} className="absolute right-1/3 top-6 hidden -rotate-12 lg:block" />
      <FoxGuide pose="guide" size="md" surface="welcome" className="bottom-5 left-8 hidden lg:block" />

      <div className="mx-auto max-w-[1120px]">
        <header className="mb-12 text-center">
          <h2
            ref={addRevealRef}
            className="seichi-reveal font-display text-[clamp(24px,3.4vw,34px)] font-bold text-fg-heading text-balance"
          >
            {t.hiw_title}
          </h2>
          <p
            ref={addRevealRef}
            className="seichi-reveal mx-auto mt-3 max-w-[520px] text-[14px] leading-relaxed text-muted-foreground"
          >
            {t.hiw_sub}
          </p>
        </header>

        {/* Journey: dashed line threaded behind the four markers on desktop */}
        <div className="relative">
          <div
            className="pointer-events-none absolute left-6 right-6 top-6 hidden border-t-2 border-dashed border-primary/45 lg:block"
            aria-hidden="true"
          />

          <ol className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <StepCard key={i} step={step} index={i} addRevealRef={addRevealRef} />
            ))}
          </ol>
        </div>

        {/* Auth note */}
        <div className="mt-14 flex flex-col items-center gap-5">
          <span className="inline-flex items-center gap-2 rounded-[50px] border border-border bg-background px-4 py-2 text-[12px] font-medium text-muted-foreground">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2.5" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {t.hero_auth_hint}
          </span>
        </div>
      </div>
    </section>
  );
}
