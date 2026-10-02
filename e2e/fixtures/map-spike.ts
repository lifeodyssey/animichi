import type { Page, Route } from "@playwright/test";
import { MAP_SPIKE_BACKGROUND, MAP_SPIKE_EARTH } from "../../apps/web/src/features/map-spike/map-colors";

const EARTH_VECTOR_TILE = Buffer.from("GiB4AgoFZWFydGgSEhgDIg4JAAAagEAAAIBA/z8ADyiAIA==", "base64");
const EMPTY_SPRITE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const fulfillEarthTile = (route: Route) => route.fulfill({
  body: EARTH_VECTOR_TILE,
  contentType: "application/vnd.mapbox-vector-tile",
  status: 200,
});

const fulfillSpriteJson = (route: Route) => route.fulfill({
  body: "{}",
  contentType: "application/json",
  status: 200,
});

const fulfillSpritePng = (route: Route) => route.fulfill({
  body: EMPTY_SPRITE_PNG,
  contentType: "image/png",
  status: 200,
});

const fulfillEmptyAsset = (route: Route) => route.fulfill({ status: 204 });

export const routeRenderedMap = async (page: Page): Promise<void> => {
  await page.route("**/tiles/**/*.mvt", fulfillEarthTile);
  await page.route("**/tiles/sprites/v4/light*.json", fulfillSpriteJson);
  await page.route("**/tiles/sprites/v4/light*.png", fulfillSpritePng);
  await page.route("**/tiles/fonts/**/*.pbf", fulfillEmptyAsset);
};

export const routeEmptyMap = async (page: Page): Promise<void> => {
  await page.route("**/tiles/**/*.mvt", fulfillEmptyAsset);
  await page.route("**/tiles/sprites/v4/light*.json", fulfillSpriteJson);
  await page.route("**/tiles/sprites/v4/light*.png", fulfillSpritePng);
  await page.route("**/tiles/fonts/**/*.pbf", fulfillEmptyAsset);
};

export const routeTileOutage = async (page: Page, status: 404 | 500): Promise<void> => {
  await page.route("**/tiles/**", (route) => route.fulfill({ body: "tile outage", status }));
};

export interface MapFrame {
  readonly backgroundPixels: number;
  readonly earthPixels: number;
  readonly renderer: string;
  readonly sampledPixels: number;
}

/** Where the map element is sampled, as (x, y) fractions of its box.
 *
 *  The spike paints its OWN marks over the tiles — the pilgrimage route line
 *  (`map-layers.ts`, #c1440e) and the five spot markers (`map-controller.ts`) —
 *  and at the lane's viewport they share one horizontal band across the middle
 *  of the map (roughly y 0.4–0.63). A sample that lands on a mark reads that
 *  mark's colour, not the style background, so the 204 case's
 *  `backgroundPixels === sampledPixels` could never hold. These rows and columns
 *  sit clear of the band, which leaves the assertion exactly as strong and keeps
 *  the app's marks out of the sample it counts. */
const SAMPLE_COLUMNS = [0.1, 0.5, 0.9] as const;
const SAMPLE_ROWS = [0.1, 0.3, 0.9] as const;

const captureMapColors = async (page: Page): Promise<number[][]> => {
  const screenshot = await page.locator(".map-spike__gl").screenshot();
  return page.evaluate(async (args: { columns: readonly number[]; encoded: string; rows: readonly number[] }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${args.encoded}`;
    await image.decode();
    const surface = document.createElement("canvas");
    [surface.width, surface.height] = [image.width, image.height];
    const context = surface.getContext("2d");
    if (context === null) return [];
    context.drawImage(image, 0, 0);
    return args.columns.flatMap((x) => args.rows.map((y) => [...context.getImageData(Math.floor(image.width * x), Math.floor(image.height * y), 1, 1).data]));
  }, { columns: SAMPLE_COLUMNS, encoded: screenshot.toString("base64"), rows: SAMPLE_ROWS });
};

const readRenderer = (page: Page): Promise<string> => page.evaluate(() => {
  const canvas = document.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
  const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
  if (gl === null || gl === undefined) return "";
  const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
  return rendererInfo === null ? String(gl.getParameter(gl.RENDERER)) : String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL));
});

const countColor = (colors: readonly number[][], target: readonly number[]): number => {
  return colors.filter((color) => color.every((value, index) => Math.abs(value - (target.at(index) ?? Number.NaN)) <= 1)).length;
};

/** `#rrggbb` as the RGBA quadruple `getImageData` returns, so the comparison is
 *  against the SAME literals `map-style.ts` paints (they drifted when copied). */
const rgba = (hex: string): readonly number[] => {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return [...channels, 255];
};

export const readMapFrame = async (page: Page): Promise<MapFrame> => {
  const colors = await captureMapColors(page);
  return {
    backgroundPixels: countColor(colors, rgba(MAP_SPIKE_BACKGROUND)),
    earthPixels: countColor(colors, rgba(MAP_SPIKE_EARTH)),
    renderer: await readRenderer(page),
    sampledPixels: colors.length,
  };
};
