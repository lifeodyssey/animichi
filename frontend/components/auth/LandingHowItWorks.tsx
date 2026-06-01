"use client";

import { Search, SplitSquareHorizontal, CheckCircle2, Footprints } from "lucide-react";
import BeforeAfter from "@/components/generative/BeforeAfter";
import { cn } from "@/lib/utils";
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
  featured = false,
}: {
  step: HowItWorksStep;
  index: number;
  addRevealRef: (el: HTMLElement | null) => void;
  featured?: boolean;
}) {
  return (
    <li
      ref={addRevealRef}
      className={cn(
        "seichi-reveal flex flex-col items-start gap-3 rounded-[18px] border border-border bg-card",
        featured
          ? "p-5 sm:col-span-2 sm:flex-row sm:items-start sm:gap-6"
          : "flex-1 p-5",
      )}
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      <div className={cn("flex flex-col gap-3", featured && "sm:flex-1")}>
        <StepIcon index={index} />
        <div className="flex flex-col gap-1.5">
          <h3 className="font-display text-[15px] font-bold text-foreground">{step.title}</h3>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{step.desc}</p>
        </div>
      </div>
      {step.accent && (
        <div className={cn(featured && "sm:flex-1 sm:self-stretch")}>{step.accent}</div>
      )}
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
          className="h-44 w-full rounded-xl sm:h-full sm:min-h-[180px]"
        />
      ),
    },
    { title: t.hiw_step3_title, desc: t.hiw_step3_desc },
    { title: t.hiw_step4_title, desc: t.hiw_step4_desc },
  ];

  return (
    <section className="bg-card px-5 py-14 sm:px-8 sm:py-16">
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
            className="seichi-reveal mx-auto mt-3 max-w-[540px] text-[14px] leading-relaxed text-muted-foreground"
          >
            {t.hiw_sub}
          </p>
        </div>

        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, i) => (
            <HowItWorksStep
              key={i}
              step={step}
              index={i}
              addRevealRef={addRevealRef}
              featured={i === 1}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}
