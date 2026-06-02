"use client";

import LeafSprig from "@/components/landing/decor/LeafSprig";
import Stamp from "@/components/landing/decor/Stamp";

interface HeroParchmentPanelProps {
  headline: string;
  lead: string;
  authHint: string;
}

/**
 * Left hero panel — a page lifted from the pilgrimage journal. Stacked parchment
 * sheets with a real cast shadow, a vermillion shrine stamp pressed over the
 * lower-left edge, and a hand-set tilt. Materiality carries the brand, not garnish.
 */
export default function HeroParchmentPanel({
  headline,
  lead,
  authHint,
}: HeroParchmentPanelProps) {
  return (
    <div className="entrance-up pointer-events-none relative max-w-[450px]">
      <LeafSprig size={58} className="absolute -left-5 -top-9 z-10 -rotate-[20deg]" />

      <div className="paper-surface paper-stack paper-fold relative -rotate-[1.4deg] rounded-[22px] px-9 py-8 lg:px-11 lg:py-9">
        <h1 className="font-display text-[clamp(30px,4.6vw,52px)] font-bold leading-[1.1] text-fg-heading text-balance">
          {headline}
        </h1>

        {/* hand-drawn ink divider — continuous wavy stroke */}
        <svg viewBox="0 0 200 8" className="mt-4 h-2 w-36 text-explore/70" fill="none" aria-hidden="true">
          <path d="M2 5 C34 1, 56 7, 88 4 C120 1, 150 7, 182 4 C190 3, 195 5, 198 4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>

        <p className="mt-4 max-w-[34ch] text-[15px] leading-[1.7] text-fg/85">
          {lead}
        </p>

        {/* auth tag — readable, ticket-like */}
        <span className="mt-6 inline-flex items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-1.5 text-[12px] font-semibold text-muted-foreground shadow-sm">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2.5" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {authHint}
        </span>
      </div>

      {/* Vermillion shrine stamp — pressed onto the lower-right of the page */}
      <Stamp
        ringText="聖地巡礼"
        glyph="torii"
        size={84}
        rotate={-12}
        className="absolute -bottom-5 right-3 z-10"
      />
    </div>
  );
}
