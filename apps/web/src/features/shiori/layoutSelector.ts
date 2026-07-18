/**
 * Photo-count-driven layout selection for the しおり family (S4.1).
 * The data decides the layout — there is no manual layout switch.
 */

export type ShioriStatus = "planned" | "completed";

export type ShioriLayout = "ticket" | "single-panel" | "album-grid" | "poster-fallback";

/** Album grid shows at most this many tiles; the rest collapse into a +N badge. */
export const ALBUM_GRID_CAPACITY = 4;

export function selectShioriLayout(status: ShioriStatus, photoCount: number): ShioriLayout {
  if (status === "planned") return "ticket";
  if (photoCount >= 3) return "album-grid";
  if (photoCount >= 1) return "single-panel";
  return "poster-fallback";
}

export function visibleAlbumCount(photoCount: number): number {
  return Math.min(photoCount, ALBUM_GRID_CAPACITY);
}

export function albumOverflowCount(photoCount: number): number {
  return Math.max(photoCount - ALBUM_GRID_CAPACITY, 0);
}
