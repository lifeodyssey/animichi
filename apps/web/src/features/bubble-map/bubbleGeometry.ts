import type { AnimeOverviewCircle } from "@seichijunrei/contract";

export const MIN_BUBBLE_RADIUS = 14;
export const MAX_BUBBLE_RADIUS = 44;

const EDGE_INSET_PCT = 8;

/** Region bubble ready to paint on the overlay: normalized position + area-scaled radius. */
export interface BubblePlacement {
  readonly region: string;
  readonly count: number;
  readonly radius: number;
  readonly leftPct: number;
  readonly topPct: number;
}

/** Area (πr²) is proportional to spot count, so the radius tracks √count. */
export function bubbleRadius(count: number, maxCount: number): number {
  if (maxCount <= 0) return MIN_BUBBLE_RADIUS;
  const ratio = Math.sqrt(Math.max(count, 0) / maxCount);
  return MIN_BUBBLE_RADIUS + (MAX_BUBBLE_RADIUS - MIN_BUBBLE_RADIUS) * ratio;
}

export function circlesMaxCount(circles: readonly AnimeOverviewCircle[]): number {
  return circles.reduce((max, circle) => Math.max(max, circle.count), 0);
}

export function hasBubbles(circles: readonly AnimeOverviewCircle[]): boolean {
  return circles.length > 0;
}

function projectAxis(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return EDGE_INSET_PCT + ((value - min) / (max - min)) * (100 - 2 * EDGE_INSET_PCT);
}

interface Extent {
  readonly min: number;
  readonly max: number;
}

function extent(values: readonly number[]): Extent {
  return { min: Math.min(...values), max: Math.max(...values) };
}

function toPlacement(circle: AnimeOverviewCircle, lat: Extent, lng: Extent, maxCount: number): BubblePlacement {
  return {
    region: circle.region,
    count: circle.count,
    radius: bubbleRadius(circle.count, maxCount),
    leftPct: projectAxis(circle.lng, lng.min, lng.max),
    // Latitude axis is inverted: the northernmost region sits nearest the top.
    topPct: projectAxis(circle.lat, lat.max, lat.min),
  };
}

export function bubblePlacements(circles: readonly AnimeOverviewCircle[]): readonly BubblePlacement[] {
  if (!hasBubbles(circles)) return [];
  const lat = extent(circles.map((c) => c.lat));
  const lng = extent(circles.map((c) => c.lng));
  const maxCount = circlesMaxCount(circles);
  return circles.map((circle) => toPlacement(circle, lat, lng, maxCount));
}
