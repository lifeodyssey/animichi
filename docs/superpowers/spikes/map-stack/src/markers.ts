import maplibregl from "maplibre-gl";
import { COLORS, SPOTS, type Spot } from "./constants";

const pinText = (spot: Spot, index: number): string => {
  if (spot.kind === "start") {
    return "出";
  }
  if (spot.kind === "highlight") {
    return "★";
  }
  return String(index + 1);
};

const classNameFor = (spot: Spot): string => {
  return `pin-marker pin-${spot.kind}`;
};

const markerElement = (spot: Spot, index: number): HTMLElement => {
  const marker = document.createElement("div");
  marker.className = classNameFor(spot);
  marker.textContent = pinText(spot, index);
  marker.title = spot.label;
  return marker;
};

export const addDomMarkers = (map: maplibregl.Map): maplibregl.Marker[] => {
  return SPOTS.map((spot, index) => {
    return new maplibregl.Marker({
      element: markerElement(spot, index),
      anchor: "bottom"
    })
      .setLngLat([...spot.coord])
      .addTo(map);
  });
};

export const svgPin = (spot: Spot, index: number, x: number, y: number): string => {
  const label = pinText(spot, index);
  const fill = spot.kind === "highlight" ? COLORS.gold : spot.kind === "start" ? COLORS.teal : "#fff";
  const stroke = spot.kind === "normal" ? COLORS.teal : COLORS.line;
  const textFill = spot.kind === "normal" ? COLORS.teal : "#fff";
  const r = spot.kind === "highlight" ? 21 : 18;

  return `
    <g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <circle cx="0" cy="0" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="3" />
      <text x="0" y="6" text-anchor="middle" font-size="18" font-weight="800" fill="${textFill}">${label}</text>
    </g>
  `;
};
