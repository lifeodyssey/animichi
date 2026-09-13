/**
 * Shared Animal Island button classes for chat surfaces. The package `<Button>`
 * already emits the structural classes (`animal-btn`, `animal-btn-{type}`,
 * `animal-btn-{size}`, `animal-btn-block`); `chatButtonClass` adds only the
 * chat extras — wrap-friendly sizing, the ground-ink focus ring, palette tones
 * via `--animal-*` vars. `animalButtonClass` is the same set PLUS the
 * structural classes, for native elements (`<a>`) a package Button cannot be.
 */
export type ChatButtonTone = "paper" | "primary" | "explore" | "gold";
export type ChatButtonSize = "small" | "middle";
export type ChatButtonAppearance = "primary" | "default" | "dashed" | "text" | "link";

const BASE = "[height:auto] [white-space:normal] text-center [font-weight:800] [line-height:1.35] focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ground-ink motion-reduce:transition-none";

/* Middle stays the 44px touch target; small is for dense inline surfaces
 * (notice banners) where a full-height button out-shouts the message — 36px
 * still clears the WCAG 2.2 24px floor. */
const SIZE: Readonly<Record<ChatButtonSize, string>> = {
  middle: "[min-height:44px] px-4 py-2.5",
  small: "[min-height:36px] px-3 py-1.5 text-sm",
};

const TONE: Readonly<Record<ChatButtonTone, string>> = {
  paper: "[--animal-bg-color:var(--color-paper)] [--animal-bg-color-secondary:var(--color-muted)] [--animal-text-color:var(--color-fg)] [--animal-border-color:var(--color-border-soft)] [--animal-primary-color:var(--color-primary-strong)]",
  primary: "[--animal-bg-color:var(--color-primary-soft)] [--animal-text-color:var(--color-primary-strong)] [--animal-border-color:var(--color-primary)]",
  explore: "[--animal-bg-color:var(--color-explore-bg)] [--animal-text-color:var(--color-explore-fg)] [--animal-border-color:var(--color-explore-fg)]",
  gold: "[--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)] [--animal-border-color:var(--color-gold)]",
};

export interface ChatButtonStyle {
  readonly tone?: ChatButtonTone;
  readonly size?: ChatButtonSize;
  readonly className?: string;
}

export interface AnimalButtonStyle extends ChatButtonStyle {
  readonly appearance?: ChatButtonAppearance;
  readonly block?: boolean;
}

export function chatButtonClass(options: ChatButtonStyle = {}): string {
  return [BASE, SIZE[options.size ?? "middle"], TONE[options.tone ?? "paper"], options.className ?? ""]
    .filter(Boolean)
    .join(" ");
}

export function animalButtonClass(options: AnimalButtonStyle = {}): string {
  const structural = ["animal-btn", `animal-btn-${options.appearance ?? "primary"}`, `animal-btn-${options.size ?? "middle"}`, options.block ? "animal-btn-block" : ""];
  return [...structural, chatButtonClass(options)]
    .filter(Boolean)
    .join(" ");
}
