"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const chipDotVariants = cva("size-2.5 shrink-0 rounded-full", {
  variants: {
    tone: { leaf: "bg-leaf", teal: "bg-primary", gold: "bg-cta" },
  },
  defaultVariants: { tone: "leaf" },
});

type DotTone = NonNullable<VariantProps<typeof chipDotVariants>["tone"]>;

/** NookPhone pastel tiles (DESIGN.md accent tier) — colored fill, no marker dot. */
const TILE_TONES = {
  "nook-teal":
    "bg-nook-teal text-nook-teal-fg shadow-[0_4px_0_0_var(--color-nook-teal-shadow)] active:shadow-[0_1px_0_0_var(--color-nook-teal-shadow)]",
  "nook-yellow":
    "bg-nook-yellow text-nook-yellow-fg shadow-[0_4px_0_0_var(--color-nook-yellow-shadow)] active:shadow-[0_1px_0_0_var(--color-nook-yellow-shadow)]",
  "nook-pink":
    "bg-nook-pink text-nook-pink-fg shadow-[0_4px_0_0_var(--color-nook-pink-shadow)] active:shadow-[0_1px_0_0_var(--color-nook-pink-shadow)]",
} as const;

type TileTone = keyof typeof TILE_TONES;

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: DotTone | TileTone;
}

function isTile(tone: ChipProps["tone"]): tone is TileTone {
  return tone != null && tone in TILE_TONES;
}

/**
 * Chip — a pill example-suggestion button. Two appearances:
 * - dot tones (`leaf`/`teal`/`gold`): cream pill with a leading marker dot
 * - NookPhone tile tones (`nook-*`): pastel fill with the game-press 3D shadow
 *   (AA-verified text pairs; ≥44px touch height per DESIGN.md)
 */
export function Chip({ className, tone = "leaf", children, type, ...props }: ChipProps) {
  if (isTile(tone)) {
    return (
      <button
        type={type ?? "button"}
        className={cn(
          "flex min-h-[44px] items-center rounded-[50px] px-4 py-2 text-[14px] font-bold transition-transform duration-150 hover:-translate-y-px active:translate-y-[2px]",
          TILE_TONES[tone],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type={type ?? "button"}
      className={cn(
        "flex min-h-[44px] items-center gap-2 rounded-[50px] border border-border bg-card px-3.5 py-2 text-[13px] font-semibold text-fg shadow-sm transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-explore",
        className,
      )}
      {...props}
    >
      <span className={chipDotVariants({ tone: tone as DotTone })} aria-hidden="true" />
      {children}
    </button>
  );
}
