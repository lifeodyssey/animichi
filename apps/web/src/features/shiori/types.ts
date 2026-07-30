import type { TimedItinerary } from "@animichi/contract";

/** A 対比図 composite selected onto the しおり. */
export interface ShioriPhoto {
  id: string;
  spotName: string;
  /** Scene attribution, e.g. 第8話 41:12. */
  sceneLabel: string;
  /** Capture time label, e.g. 10:48. */
  capturedAt: string;
  imageUrl: string;
}

/** Raw photo entering the pipeline; bytes MUST pass sanitizePhoto before a render URL exists. */
export interface ShioriPhotoInput {
  id: string;
  spotName: string;
  sceneLabel: string;
  capturedAt: string;
  photo: Blob;
}

/** Pipeline output: imageUrl is minted from the sanitized blob only. */
export interface SanitizedShioriPhoto extends ShioriPhoto {
  blob: Blob;
}

/** Display metadata shared by every しおり layout. */
export interface ShioriMeta {
  routeTitle: string;
  animeTitle: string;
  dateLabel: string;
}

export type ShioriRouteProps = Readonly<{
  meta: ShioriMeta;
  itinerary: TimedItinerary;
}>;
