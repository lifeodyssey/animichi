"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const chipDotVariants = cva("size-2.5 shrink-0 rounded-full", {
  variants: {
    tone: { leaf: "bg-leaf", teal: "bg-primary", gold: "bg-cta" },
  },
  defaultVariants: { tone: "leaf" },
});

export interface ChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chipDotVariants> {}

/**
 * Chip — a pill example-suggestion button with a leading colored marker dot
 * (the "Try an example" row). App-owned design-system control: the dot tone +
 * the cream pill + hover-lift are bespoke, so it lives here as a named component
 * (cva tones drive the dot color via tokens, replacing inline style colors).
 */
export function Chip({ className, tone, children, type, ...props }: ChipProps) {
  return (
    <button
      type={type ?? "button"}
      className={cn(
        "flex items-center gap-2 rounded-[50px] border border-border bg-card px-3.5 py-2 text-[13px] font-semibold text-fg shadow-sm transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-explore",
        className,
      )}
      {...props}
    >
      <span className={chipDotVariants({ tone })} aria-hidden="true" />
      {children}
    </button>
  );
}
