import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

export const protocol = new Protocol({ metadata: true });

export const registerPmtilesProtocol = (): void => {
  maplibregl.addProtocol("pmtiles", protocol.tile);
};
