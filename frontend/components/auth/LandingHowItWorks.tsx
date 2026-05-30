"use client";

import { Search, SplitSquareHorizontal, CheckCircle2, Footprints } from "lucide-react";
import BeforeAfter from "@/components/generative/BeforeAfter";
import { useDict } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";

interface HowItWorksStep {
  title: string;
  desc: string;
  accent?: React.ReactNode;
}

const STEP_ICONS = [Search, SplitSquareHorizontal, CheckCircle2, Footprints];

function StepIcon({ index }: { index: number }) {
  const Icon = STEP_ICONS[index];
  return (
    <div className="relative flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-sm">
      <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
        {index + 1}
      </span>
      <Icon size={18} className="text-primary" aria-hidden="true" />
    </div>
  );
}

function HowItWorksStep({
  step,
  index,
  addRevealRef,
}: {
  step: HowItWorksStep;
  index: number;
  addRevealRef: (el: HTMLElement | null) => void;
}) {
  return (
    <li
      ref={addRevealRef}
      className="seichi-reveal flex flex-1 flex-col items-start gap-3 rounded-[18px] border border-border bg-card p-5"
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      <StepIcon index={index} />
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-[15px] font-bold text-foreground">{step.title}</h3>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{step.desc}</p>
      </div>
      {step.accent}
    </li>
  );
}

export function LandingHowItWorks() {
  const dict = useDict();
  const t = dict.landing_hero.landing;
  const addRevealRef = useScrollReveal();

  const steps: HowItWorksStep[] = [
    { title: t.hiw_step1_title, desc: t.hiw_step1_desc },
    {
      title: t.hiw_step2_title,
      desc: t.hiw_step2_desc,
      accent: (
        <BeforeAfter
          leftSrc="/images/landing/suga-shrine-reality-perspective-v2.png"
          rightSrc="/images/landing/suga-shrine-anime-source.jpg"
          leftAlt={t.hero_real_label}
          rightAlt={t.hero_anime_label}
          leftLabel={t.hero_real_label}
          rightLabel={t.hero_anime_label}
          className="mt-1 h-28 w-full rounded-xl"
        />
      ),
    },
    { title: t.hiw_step3_title, desc: t.hiw_step3_desc },
    { title: t.hiw_step4_title, desc: t.hiw_step4_desc },
  ];

  return (
    <section className="bg-card px-5 py-12 sm:px-8">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-10 text-center">
          <h2
            ref={addRevealRef}
            className="seichi-reveal font-display text-[clamp(20px,3vw,28px)] font-bold text-foreground"
          >
            {t.hiw_title}
          </h2>
          <p
            ref={addRevealRef}
            className="seichi-reveal mx-auto mt-2 max-w-[540px] text-[13px] leading-relaxed text-muted-foreground"
          >
            {t.hiw_sub}
          </p>
        </div>

        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <HowItWorksStep key={i} step={step} index={i} addRevealRef={addRevealRef} />
          ))}
        </ol>
      </div>
    </section>
  );
}
