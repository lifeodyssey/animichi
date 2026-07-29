import maplibregl from "maplibre-gl";
import {
  BAD_TILE_URL,
  COLORS,
  SPOTS,
  STATIC_BOUNDS,
  STATIC_SIZE,
  TILE_URL
} from "./constants";
import { createMapStyle } from "./map-style";
import { svgPin } from "./markers";
import { projectWebMercator, type Point, type Size } from "./projection";

const idle = (callback: () => void): void => {
  const idleWindow = window as Window & {
    requestIdleCallback?: (handler: () => void, options: { timeout: number }) => number;
  };
  if (typeof idleWindow.requestIdleCallback === "function") {
    idleWindow.requestIdleCallback(callback, { timeout: 1800 });
    return;
  }
  globalThis.setTimeout(callback, 250);
};

const nextFrame = (): Promise<void> => {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
};

const onceIdle = (map: maplibregl.Map): Promise<void> => {
  return new Promise((resolve) => map.once("idle", () => resolve()));
};

const overlaySvg = (points: readonly Point[], size: Size): string => {
  const path = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const pins = SPOTS.map((spot, index) => svgPin(spot, index, points[index].x, points[index].y)).join("");

  return `
    <svg class="route-overlay" viewBox="0 0 ${size.width} ${size.height}" aria-hidden="true">
      <polyline points="${path}" fill="none" stroke="${COLORS.brown}" stroke-width="8"
        stroke-linecap="round" stroke-dasharray="18 16" opacity="0.95" />
      ${pins}
    </svg>
  `;
};

const illustrationPoints = (): readonly Point[] => {
  return SPOTS.map((spot) => projectWebMercator(spot.coord, STATIC_BOUNDS, STATIC_SIZE));
};

const illustrationOverlaySvg = (): string => {
  return overlaySvg(illustrationPoints(), STATIC_SIZE);
};

const staticBounds = (): [[number, number], [number, number]] => {
  return [
    [STATIC_BOUNDS.west, STATIC_BOUNDS.south],
    [STATIC_BOUNDS.east, STATIC_BOUNDS.north]
  ];
};

const mapSize = (layer: HTMLElement): Size => {
  return { width: layer.clientWidth, height: layer.clientHeight };
};

const mapPoints = (map: maplibregl.Map): readonly Point[] => {
  return SPOTS.map((spot) => {
    const point = map.project([spot.coord[0], spot.coord[1]]);
    return { x: point.x, y: point.y };
  });
};

const syncOverlayToMap = (root: HTMLElement, layer: HTMLElement, map: maplibregl.Map): void => {
  const overlay = root.querySelector<SVGSVGElement>(".route-overlay");
  if (!overlay) {
    throw new Error("Static card overlay failed");
  }
  overlay.outerHTML = overlaySvg(mapPoints(map), mapSize(layer));
};

const settleVisibleMap = async (
  root: HTMLElement,
  layer: HTMLElement,
  fallback: HTMLElement,
  map: maplibregl.Map,
  isCurrent: () => boolean
): Promise<void> => {
  layer.classList.add("is-visible");
  fallback.classList.add("is-hidden");
  await nextFrame();
  if (!isCurrent()) {
    return;
  }
  // resize() refreshes MapLibre's painter/transform from the now-visible box;
  // fitBounds() must follow so projections use the final card dimensions.
  map.resize();
  map.fitBounds(staticBounds(), { animate: false, padding: 0 });
  await onceIdle(map);
  if (isCurrent()) {
    syncOverlayToMap(root, layer, map);
  }
};

const illustration = (): string => {
  return `
    <div class="static-illustration">
      <svg viewBox="0 0 1000 620" role="img" aria-label="Branded Uji route illustration">
        <defs>
          <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stop-color="#faf6ee" />
            <stop offset="1" stop-color="#d9fff9" />
          </linearGradient>
        </defs>
        <rect width="1000" height="620" rx="24" fill="url(#sky)" />
        <path d="M0 410 C170 360 250 500 420 438 S690 330 1000 392 L1000 620 L0 620 Z"
          fill="#e7d8bc" />
        <path d="M30 520 C190 468 360 560 520 502 S790 430 1000 492"
          fill="none" stroke="${COLORS.teal}" stroke-width="42" stroke-linecap="round" opacity=".78" />
        <path d="M0 455 C220 398 322 508 472 450 S720 380 1000 420"
          fill="none" stroke="#fff8e7" stroke-width="16" stroke-linecap="round" opacity=".95" />
        <circle cx="782" cy="132" r="58" fill="${COLORS.gold}" opacity=".9" />
        <path d="M96 330 h118 l46 -82 l54 82 h98 l72 -120 l92 154 h330"
          fill="none" stroke="${COLORS.brown}" stroke-width="22" stroke-linejoin="round" opacity=".42" />
      </svg>
    </div>
  `;
};

export const mountStaticCard = (root: HTMLElement, checkbox: HTMLInputElement): void => {
  let map: maplibregl.Map | null = null;
  let renderId = 0;

  const render = (simulateFailure: boolean): void => {
    renderId += 1;
    const currentRenderId = renderId;
    map?.remove();
    map = null;
    root.innerHTML = `${illustration()}<div class="static-map-layer"></div>${illustrationOverlaySvg()}`;
    const layer = root.querySelector<HTMLElement>(".static-map-layer");
    const fallback = root.querySelector<HTMLElement>(".static-illustration");
    if (!layer || !fallback) {
      throw new Error("Static card scaffold failed");
    }

    idle(() => {
      if (currentRenderId !== renderId) {
        return;
      }
      let failed = false;
      const nextMap = new maplibregl.Map({
        container: layer,
        style: createMapStyle("pmtiles", simulateFailure ? BAD_TILE_URL : TILE_URL),
        bounds: staticBounds(),
        interactive: false,
        attributionControl: false,
        fadeDuration: 0
      });
      map = nextMap;
      const isCurrent = (): boolean => currentRenderId === renderId && map === nextMap;

      nextMap.on("error", () => {
        failed = true;
        layer.classList.remove("is-visible");
        fallback.classList.remove("is-hidden");
      });
      nextMap.once("idle", () => {
        if (failed || !isCurrent()) {
          return;
        }
        void settleVisibleMap(root, layer, fallback, nextMap, isCurrent);
      });
    });
  };

  checkbox.addEventListener("change", () => render(checkbox.checked));
  render(checkbox.checked);
};
