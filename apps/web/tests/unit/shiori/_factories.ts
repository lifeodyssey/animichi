import type { TimedItinerary, TimedStop } from "@seichijunrei/contract";
import type { ShioriMeta, ShioriPhoto, ShioriPhotoInput } from "../../../src/features/shiori/types";
import { makeJpegBlobWithExif } from "./_jpegFixtures";

export function makeStop(overrides: Partial<TimedStop> = {}): TimedStop {
  return {
    cluster_id: "stop-station",
    name: "飛騨古川駅",
    arrive: "09:31",
    depart: "09:50",
    dwell_minutes: 19,
    lat: 36.238,
    lng: 137.186,
    photo_count: 12,
    ...overrides,
  };
}

export function makeItinerary(overrides: Partial<TimedItinerary> = {}): TimedItinerary {
  return {
    stops: [
      makeStop(),
      makeStop({ cluster_id: "stop-shrine", name: "気多若宮神社", arrive: "10:48", depart: "12:58" }),
    ],
    legs: [],
    total_minutes: 210,
    total_distance_m: 2800,
    ...overrides,
  };
}

export function makeMeta(overrides: Partial<ShioriMeta> = {}): ShioriMeta {
  return {
    routeTitle: "飛騨古川 半日ルート",
    animeTitle: "君の名は。",
    dateLabel: "2026.7.3",
    ...overrides,
  };
}

export function makePhoto(overrides: Partial<ShioriPhoto> = {}): ShioriPhoto {
  return {
    id: "photo-1",
    spotName: "気多若宮神社",
    sceneLabel: "第8話 41:12",
    capturedAt: "10:48",
    imageUrl: "https://assets.example/comparison-1.jpg",
    ...overrides,
  };
}

export function makePhotoInput(overrides: Partial<ShioriPhotoInput> = {}): ShioriPhotoInput {
  return {
    id: "photo-1",
    spotName: "気多若宮神社",
    sceneLabel: "第8話 41:12",
    capturedAt: "10:48",
    photo: makeJpegBlobWithExif(),
    ...overrides,
  };
}

export function makePhotos(count: number): ShioriPhoto[] {
  return Array.from({ length: count }, (_, index) => {
    const label = String(index + 1);
    return makePhoto({ id: `photo-${label}`, spotName: `スポット${label}` });
  });
}
