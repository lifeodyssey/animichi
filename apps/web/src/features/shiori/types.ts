import type { TimedItinerary } from "@seichijunrei/contract";

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
