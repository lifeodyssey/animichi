"use client";

import { Card, Divider } from "animal-island-ui";

interface HeroParchmentPanelProps {
  headline: string;
  lead: string;
  authHint: string;
}

/**
 * Organic cream parchment panel — floats over the BeforeAfter hero.
 * Uses library Card type="title" for blob-radius corners.
 * Matches the left panel of 01-hero-corrected.png.
 */
export default function HeroParchmentPanel({
  headline,
  lead,
  authHint,
}: HeroParchmentPanelProps) {
  return (
    <Card
      type="title"
      className="entrance-up pointer-events-none relative max-w-[420px] cursor-default px-8 py-7 lg:px-10 lg:py-9"
    >
      {/* Decorative leaf — top left */}
      <span
        className="absolute -top-4 left-6 text-[22px] select-none"
        aria-hidden="true"
      >
        🌿
      </span>

      <h1 className="font-display text-[clamp(22px,3.8vw,40px)] font-bold leading-[1.2] text-fg-heading whitespace-pre-line text-balance">
        {headline}
      </h1>

      {/* Decorative plant divider */}
      <div className="my-4">
        <Divider type="dashed-brown" />
      </div>

      <p className="text-[14px] leading-[1.75] text-muted-foreground whitespace-pre-line">
        {lead}
      </p>

      {/* Auth hint */}
      <p className="mt-5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        {authHint}
      </p>
    </Card>
  );
}
