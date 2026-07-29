import { SPOTS, STATIC_BOUNDS, STATIC_SIZE } from "./spots";
import type { Bounds, LngLat, Size, Spot } from "./spots";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface SpotPoint {
  readonly spot: Spot;
  readonly point: Point;
}

const mercatorY = (lat: number): number => {
  const radians = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
};

export const projectWebMercator = ([lon, lat]: LngLat, bounds: Bounds, size: Size): Point => {
  const x = ((lon - bounds.west) / (bounds.east - bounds.west)) * size.width;
  const top = mercatorY(bounds.north);
  const bottom = mercatorY(bounds.south);
  const y = ((top - mercatorY(lat)) / (top - bottom)) * size.height;
  return { x, y };
};

export const illustrationSpotPoints = (): readonly SpotPoint[] => {
  return SPOTS.map((spot) => ({
    spot,
    point: projectWebMercator(spot.coord, STATIC_BOUNDS, STATIC_SIZE),
  }));
};

export const illustrationPoints = (): readonly Point[] => {
  return illustrationSpotPoints().map((pair) => pair.point);
};

export const polylinePoints = (points: readonly Point[]): string => {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
};

export const svgTranslate = (point: Point): string => {
  return `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`;
};
