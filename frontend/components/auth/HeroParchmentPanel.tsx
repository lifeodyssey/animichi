"use client";

interface HeroParchmentPanelProps {
  headline: string;
  lead: string;
}

/**
 * Left parchment panel of the hero: cream background with headline + lead copy
 * and decorative stamp illustrations. Matches 01-hero-corrected.png left half.
 */
export default function HeroParchmentPanel({ headline, lead }: HeroParchmentPanelProps) {
  return (
    <div className="entrance-up relative flex shrink-0 flex-col justify-center bg-card px-10 py-20 lg:w-[42%] lg:px-16 lg:py-0">
      {/* Decorative stamp — Mt. Fuji (top-left) */}
      <div className="absolute left-8 top-24 opacity-20 lg:left-10 lg:top-28" aria-hidden="true">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <ellipse cx="32" cy="52" rx="28" ry="6" fill="var(--color-border)" />
          <path d="M32 8L10 50h44L32 8z" fill="var(--color-muted-fg)" opacity="0.6" />
          <path d="M24 28L32 8l8 20-4-2-4 2-4-2z" fill="var(--color-bg)" />
        </svg>
      </div>

      {/* Decorative stamp — leaf (bottom-right) */}
      <div className="absolute bottom-24 right-8 opacity-[0.15] lg:bottom-32 lg:right-12" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path d="M8 40 C8 40 14 10 32 8 C32 8 42 30 24 38 C24 38 16 42 8 40z" fill="var(--color-primary)" opacity="0.5" />
          <path d="M8 40 L24 20" stroke="var(--color-primary)" strokeWidth="1.5" opacity="0.4" />
        </svg>
      </div>

      <div className="relative max-w-[480px]">
        <h1 className="font-display text-[clamp(28px,4.5vw,52px)] font-bold leading-[1.15] text-foreground whitespace-pre-line text-balance">
          {headline}
        </h1>
        <p className="mt-5 text-[15px] leading-[1.8] text-foreground/75 whitespace-pre-line">
          {lead}
        </p>
      </div>
    </div>
  );
}
