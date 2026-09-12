import type { SearchSpot } from "../../src/features/chat/lib/spot-clusters";

/** Existing film-reference assets; provenance is in public/images/landing/ATTRIBUTIONS.md.
 * These are separate Tokyo works, so no invented series episode or shared work title. */
export const tokyoSceneStills: readonly SearchSpot[] = [
  { id: "suga", name: "須賀神社 男坂", city: "新宿区", screenshotUrl: "/images/landing/suga-shrine-anime-source.webp" },
  { id: "sangubashi", name: "参宮橋 1号踏切", city: "渋谷区", screenshotUrl: "/images/compare/anime.jpg" },
];
