import type { SelectedPlace } from "../../src/features/chat/lib/selected-places";

/** Existing place names and reference assets. Viewpoint grouping is synthetic UI data,
 * not a catalog/geographic claim. In particular, the two Suga groups reuse comparison assets. */
export const selectedPlaceFixtures = [
  { id: "suga", name: "須賀神社 男坂", city: "新宿区", viewpoints: [
    { id: "suga-a", frames: [{ id: "anime", url: "/images/landing/suga-shrine-anime-source.webp" }, { id: "real", url: "/images/landing/suga-shrine-reality-perspective-v2.webp" }] },
    { id: "suga-b", frames: [{ id: "real", url: "/images/landing/suga-shrine-reality-perspective-v2.webp" }] },
  ] },
  { id: "sangubashi", name: "参宮橋 1号踏切", city: "渋谷区", viewpoints: [{ id: "crossing", frames: [{ id: "anime", url: "/images/compare/anime.jpg" }, { id: "real", url: "/images/compare/real.jpg" }] }] },
  { id: "uji", name: "宇治橋", city: "宇治市", viewpoints: [{ id: "bridge", frames: [{ id: "scene", url: "/images/landing/route-uji.webp" }] }] },
] as const satisfies readonly SelectedPlace[];

export const manySelectedPlaces = Array.from({ length: 80 }, (_, index) => ({ ...(selectedPlaceFixtures[index % selectedPlaceFixtures.length] ?? selectedPlaceFixtures[0]), id: `place-${String(index)}` }));
