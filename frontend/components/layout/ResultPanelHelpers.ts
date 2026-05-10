import type { PilgrimagePoint } from "../../lib/types";

// ---------------------------------------------------------------------------
// Episode-range helpers
// ---------------------------------------------------------------------------

const EP_RANGE = 4; // episodes per bucket

export function epRangeLabel(ep: number): string {
  const start = Math.floor((ep - 1) / EP_RANGE) * EP_RANGE + 1;
  const end = start + EP_RANGE - 1;
  return `EP ${start}-${end}`;
}

export function buildEpRanges(points: PilgrimagePoint[]): string[] {
  const ranges = new Set<string>();
  for (const p of points) {
    // ep=0 means "no episode" (Anitabi uses 0 for movies/unspecified)
    if (p.episode != null && p.episode > 0) {
      ranges.add(epRangeLabel(p.episode));
    }
  }
  // Sort ranges numerically by their start episode.
  // Extract the first run of digits (e.g. "EP 5-8" → "5") for comparison.
  return Array.from(ranges).sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
    const numB = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
    return numA - numB;
  });
}

// ---------------------------------------------------------------------------
// Area helpers — derive region from coordinates
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Area helpers — use reverse-geocoded city field from backend
// ---------------------------------------------------------------------------

/** Build area labels from point.city, using `otherLabel` for unknown. */
export function buildAreasI18n(points: PilgrimagePoint[], otherLabel: string): string[] {
  const areas = new Set<string>();
  for (const p of points) areas.add(p.city || otherLabel);
  return Array.from(areas).sort((a, b) => a.localeCompare(b));
}

export function pointAreaI18n(p: PilgrimagePoint, otherLabel: string): string {
  return p.city || otherLabel;
}
