import type { Page, Route } from "@playwright/test";

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

const captureMapColors = async (page: Page): Promise<number[][]> => {
  const screenshot = await page.locator(".map-spike__gl").screenshot();
  return page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const surface = document.createElement("canvas");
    [surface.width, surface.height] = [image.width, image.height];
    const context = surface.getContext("2d");
    if (context === null) return [];
    context.drawImage(image, 0, 0);
    return [0.2, 0.5, 0.8].flatMap((x) => [0.2, 0.5, 0.8].map((y) => [...context.getImageData(Math.floor(image.width * x), Math.floor(image.height * y), 1, 1).data]));
  }, screenshot.toString("base64"));
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

export const readMapFrame = async (page: Page): Promise<MapFrame> => {
  const colors = await captureMapColors(page);
  return {
    backgroundPixels: countColor(colors, [248, 248, 240, 255]),
    earthPixels: countColor(colors, [226, 223, 218, 255]),
    renderer: await readRenderer(page),
    sampledPixels: colors.length,
  };
};
