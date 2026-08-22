import type { Spot, SpotKind } from "./spots";

// Pin visual language (teal/gold, per DESIGN.md map-pin tokens + user-journey §6.6).
// SVG fills reference semantic CSS variables so the palette stays token-driven.
export const pinFill = (kind: SpotKind): string => {
  if (kind === "start") {
    return "var(--color-map-pin-teal)";
  }
  if (kind === "highlight") {
    return "var(--color-map-pin-orange)";
  }
  return "var(--color-paper)";
};

export const pinStroke = (kind: SpotKind): string => {
  return kind === "normal" ? "var(--color-map-pin-teal)" : "var(--color-fg)";
};

export const pinTextFill = (kind: SpotKind): string => {
  if (kind === "normal") {
    return "var(--color-map-pin-teal)";
  }
  // Teal ground needs the dark ink (5.62:1); orange keeps the white fg.
  return kind === "start" ? "var(--color-primary-ink)" : "var(--color-primary-fg)";
};

export const pinRadius = (kind: SpotKind): number => {
  return kind === "highlight" ? 21 : 18;
};

export const pinLabel = (spot: Spot, index: number): string => {
  if (spot.kind === "start") {
    return "出";
  }
  if (spot.kind === "highlight") {
    return "★";
  }
  return String(index + 1);
};
