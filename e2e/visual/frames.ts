/**
 * Visual frame registry (S0-v2 C3). The single source of truth for what the
 * visual pipeline compares: one entry per (mockup, mode) combination.
 * Adding a frame here is what makes `make visual-check PAGE=… MODE=…` see it.
 */

export type VisualMode = "day" | "night";

export interface VisualFrame {
  /** Stable key, also used for artifact names: landing-day.png, landing-day.json… */
  key: string;
  /** Output name inside e2e/visual/canonical/. */
  canonicalName: string;
  /** Mockup source path, relative to the repo root. */
  mockup: string;
  /** App route the frame converges on. */
  route: string;
  viewport: { width: number; height: number };
  mode: VisualMode;
}

export const VISUAL_FRAMES: Record<string, VisualFrame> = {
  "landing-day": {
    key: "landing-day",
    canonicalName: "landing-day.html",
    mockup: "docs/design/2026-07-06-design-sync/Landing - Seichijunrei.html",
    route: "/",
    viewport: { width: 1280, height: 800 },
    mode: "day",
  },
  "landing-night": {
    key: "landing-night",
    canonicalName: "landing-night.html",
    mockup: "docs/design/2026-07-06-design-sync/Landing - Seichijunrei.html",
    route: "/",
    viewport: { width: 1280, height: 800 },
    mode: "night",
  },
};

/**
 * Resolve the PAGE/MODE make params to a frame. A PAGE that is already a full
 * frame key ("landing-day") wins; otherwise PAGE-MODE is tried ("landing" +
 * "night" → "landing-night").
 */
export function resolveFrame(page: string, mode: string): VisualFrame {
  const direct = VISUAL_FRAMES[page];
  if (direct) return direct;
  const combined = VISUAL_FRAMES[`${page}-${mode}`];
  if (combined) return combined;
  const known = Object.keys(VISUAL_FRAMES).join(", ");
  throw new Error(`no visual frame for PAGE=${page} MODE=${mode}; known: ${known}`);
}
