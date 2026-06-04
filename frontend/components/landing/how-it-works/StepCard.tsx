import type { Step } from "@/components/auth/LandingHowItWorks";

interface StepCardProps {
  step: Step;
  index: number;
  addRevealRef: (el: HTMLElement | null) => void;
}

/** One numbered journey step: tinted icon marker, copy, and a mini preview. */
export default function StepCard({ step, index, addRevealRef }: StepCardProps) {
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
