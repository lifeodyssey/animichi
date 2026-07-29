import type { LngLat } from "./constants";

export interface Bounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

const mercatorY = (lat: number): number => {
  const radians = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
};

export const projectWebMercator = (
  [lon, lat]: LngLat,
  bounds: Bounds,
  size: Size
): Point => {
  const x = ((lon - bounds.west) / (bounds.east - bounds.west)) * size.width;
  const top = mercatorY(bounds.north);
  const bottom = mercatorY(bounds.south);
  const y = ((top - mercatorY(lat)) / (top - bottom)) * size.height;
  return { x, y };
};
