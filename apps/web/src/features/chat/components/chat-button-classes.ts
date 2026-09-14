/**
 * Shared Animal Island button classes for chat surfaces. The package `<Button>`
 * already emits the structural classes (`animal-btn`, `animal-btn-{type}`,
 * `animal-btn-{size}`, `animal-btn-block`); `chatButtonClass` adds only the
 * chat extras — wrap-friendly sizing, the ground-ink focus ring, palette tones
 * via `--animal-*` vars. `animalButtonClass` is the same set PLUS the
 * structural classes, for native elements (`<a>`) a package Button cannot be.
 *
 * `chatActionClass` covers the recovery/planning ACTION family the error
 * notices and draft footers used to hand-roll per file: an `!`-overridden
 * 44px/48px floor, wrapped 14px labels (15px on the trip submit) and the
 * primary-strong focus ring. `animalActionClass` adds the structural classes
 * for native elements. Padding and one-off hooks stay with the caller through
 * `className`; the package 3D press depth is never overridden.
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

export type ChatActionHeight = 44 | 48;
export type ChatActionFontSize = 14 | 15;
/* `gold` fills the CTA; `paper` keeps recovery actions on cream with the
 * accessible teal ink; `quiet`/`quiet-strong` are text buttons taking the
 * teal-soft hover wash in the default or the stronger teal ink. */
export type ChatActionTone = "gold" | "paper" | "quiet" | "quiet-strong";

const ACTION_HEIGHT: Readonly<Record<ChatActionHeight, string>> = {
  44: "[min-height:44px]!",
  48: "[min-height:48px]!",
};

const ACTION_FONT_SIZE: Readonly<Record<ChatActionFontSize, string>> = {
  14: "[font-size:14px]!",
  15: "[font-size:15px]!",
};

const ACTION_TONE: Readonly<Record<ChatActionTone, string>> = {
  gold: "[--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)] [--animal-border-color:var(--color-gold)]",
  paper: "[--animal-text-color:var(--color-primary-strong)] [--animal-bg-color:var(--color-paper)]",
  quiet: "[--animal-text-color:var(--color-fg)] [--animal-bg-color-secondary:var(--color-primary-soft)]",
  "quiet-strong": "[--animal-text-color:var(--color-primary-strong)] [--animal-bg-color-secondary:var(--color-primary-soft)]",
};

const ACTION_FRAME = "[height:auto]!";
const ACTION_LABEL = "[line-height:1.5]! [white-space:normal]!";
const ACTION_RING = "focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:[transition:none]!";

export interface ChatActionStyle {
  readonly height?: ChatActionHeight;
  readonly fontSize?: ChatActionFontSize;
  readonly tone?: ChatActionTone;
  readonly className?: string;
}

export interface AnimalActionStyle extends ChatActionStyle {
  readonly appearance?: ChatButtonAppearance;
  readonly block?: boolean;
}

export function chatActionClass(options: ChatActionStyle = {}): string {
  const tone = options.tone === undefined ? "" : ACTION_TONE[options.tone];
  return [ACTION_HEIGHT[options.height ?? 44], ACTION_FRAME, ACTION_FONT_SIZE[options.fontSize ?? 14], ACTION_LABEL, tone, ACTION_RING, options.className ?? ""]
    .filter(Boolean)
    .join(" ");
}

export function animalActionClass(options: AnimalActionStyle = {}): string {
  const structural = ["animal-btn", `animal-btn-${options.appearance ?? "primary"}`, "animal-btn-middle", options.block ? "animal-btn-block" : ""];
  return [...structural, chatActionClass(options)]
    .filter(Boolean)
    .join(" ");
}
