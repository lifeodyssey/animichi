"use client";

import { Search, GitCompareArrows, ListChecks, Footprints } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Stamp from "@/components/landing/decor/Stamp";
import LeafSprig from "@/components/landing/decor/LeafSprig";
import MiniSearch from "@/components/landing/how-it-works/MiniSearch";
import MiniCompare from "@/components/landing/how-it-works/MiniCompare";
import MiniChecklist from "@/components/landing/how-it-works/MiniChecklist";
import MiniMap from "@/components/landing/how-it-works/MiniMap";
import StepCard from "@/components/landing/how-it-works/StepCard";
import FoxGuide from "@/components/generative/FoxGuide";
import { useDict } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";

export interface Step {
  icon: LucideIcon;
  tint: string;
  title: string;
  desc: string;
  preview: React.ReactNode;
}

// ── Section ──────────────────────────────────────────────────────────────────

export function LandingHowItWorks() {
  const dict = useDict();
  const t = dict.landing_hero.landing;
  const addRevealRef = useScrollReveal();

  // One teal accent across all four markers (the documented interactive token,
  // matching the dashed journey line). Differentiation comes from each step's
  // distinct icon + number + mini preview, not tile colour — pumpkin orange
  // stays reserved for the marketing CTA only.
  const steps: Step[] = [
    { icon: Search, tint: "var(--color-primary)", title: t.hiw_step1_title, desc: t.hiw_step1_desc, preview: <MiniSearch /> },
    { icon: GitCompareArrows, tint: "var(--color-primary)", title: t.hiw_step2_title, desc: t.hiw_step2_desc, preview: <MiniCompare /> },
    { icon: ListChecks, tint: "var(--color-primary)", title: t.hiw_step3_title, desc: t.hiw_step3_desc, preview: <MiniChecklist /> },
    { icon: Footprints, tint: "var(--color-primary)", title: t.hiw_step4_title, desc: t.hiw_step4_desc, preview: <MiniMap /> },
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
      </div>
    </section>
  );
}
