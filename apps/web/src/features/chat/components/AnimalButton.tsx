import type { ButtonHTMLAttributes, ReactNode } from "react";

export type AnimalButtonAppearance = "primary" | "default" | "dashed" | "text" | "link";
export type AnimalButtonTone = "paper" | "primary" | "explore" | "walk" | "gold";
export type AnimalButtonSize = "small" | "middle";

interface AnimalButtonStyle {
  readonly appearance?: AnimalButtonAppearance;
  readonly tone?: AnimalButtonTone;
  readonly size?: AnimalButtonSize;
  readonly block?: boolean;
  readonly className?: string;
}

export type AnimalButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> &
  AnimalButtonStyle & Readonly<{ children: ReactNode }>;

const BASE = "animal-btn [height:auto] [white-space:normal] text-center [font-weight:800] [line-height:1.35] focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ground-ink motion-reduce:transition-none";

/* Middle stays the 44px touch target; small is for dense inline surfaces
 * (notice banners) where a full-height button out-shouts the message — 36px
 * still clears the WCAG 2.2 24px floor. */
const SIZE: Readonly<Record<AnimalButtonSize, string>> = {
  middle: "animal-btn-middle [min-height:44px] px-4 py-2.5",
  small: "animal-btn-small [min-height:36px] px-3 py-1.5 text-sm",
};

const TONE: Readonly<Record<AnimalButtonTone, string>> = {
  paper: "[--animal-bg-color:var(--color-paper)] [--animal-bg-color-secondary:var(--color-muted)] [--animal-text-color:var(--color-fg)] [--animal-border-color:var(--color-border-soft)] [--animal-primary-color:var(--color-primary-strong)]",
  primary: "[--animal-bg-color:var(--color-primary-soft)] [--animal-text-color:var(--color-primary-strong)] [--animal-border-color:var(--color-primary)]",
  explore: "[--animal-bg-color:var(--color-explore-bg)] [--animal-text-color:var(--color-explore-fg)] [--animal-border-color:var(--color-explore-fg)]",
  walk: "[--animal-bg-color:var(--color-walk-bg)] [--animal-text-color:var(--color-walk-fg)] [--animal-border-color:var(--color-walk-fg)]",
  gold: "[--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)] [--animal-border-color:var(--color-gold)]",
};

export function animalButtonClass(options: AnimalButtonStyle = {}): string {
  const appearance = options.appearance ?? "primary";
  return [BASE, `animal-btn-${appearance}`, SIZE[options.size ?? "middle"], TONE[options.tone ?? "paper"], options.block ? "animal-btn-block" : "", options.className ?? ""]
    .filter(Boolean)
    .join(" ");
}

export function AnimalButton({ appearance, tone, size, block, className, children, type = "button", ...button }: AnimalButtonProps) {
  const classes = animalButtonClass({ appearance, tone, size, block, className });
  return (
    <button {...button} type={type} className={classes}>
      <span className="min-w-0">{children}</span>
    </button>
  );
}
