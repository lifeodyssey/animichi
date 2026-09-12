import { pointPlacements } from "../../../src/features/bubble-map/bubble-geometry";
import type { AttachBasemap } from "../../../src/features/chat/components/SearchMap";

/** Deterministic viewport for DOM tests; live stories use the real MapLibre camera. */
export const attachReady: AttachBasemap = ({ points, onProject, onStatus }) => {
  onProject?.(pointPlacements(points));
  onStatus("ready");
  return () => undefined;
};
