/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins today's answer to the path neighbours of the landing routes
 * (`/healthz`, the `/tiles/` and `/img/` prefixes, the private `/img/docs`
 * namespace) and of the two public catalog reads: a trailing slash, an extra
 * segment, a different case, a percent-encoded slash and a percent-encoded
 * ordinary letter, plus the bare prefixes themselves.
 *
 * Matching today is on the raw, still-encoded pathname, case-sensitive and
 * exact, except inside the asset arms: the tile arm decodes its own key, so an
 * encoded letter reaches the same object, and the image arm hands the origin the
 * path still encoded. The `/v1` neighbours are in `gateway-entry-paths-v1.test.ts`.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN } from "./doubles/entry-seam.ts";
import {
  IMAGE_NOT_FOUND, IMAGE_PATH_INVALID, IMAGE_PLAN_REQUIRED, NOT_FOUND, TILE_NOT_FOUND,
} from "./doubles/entry-envelopes.ts";

type Neighbour = readonly [method: string, path: string, status: number, body: string, log: readonly string[]];

const NEIGHBOURS: readonly Neighbour[] = [
  ["GET", "/healthz/", 404, NOT_FOUND, []],
  ["GET", "/healthz/x", 404, NOT_FOUND, []],
  ["GET", "/HEALTHZ", 404, NOT_FOUND, []],
  ["GET", "/healthz%2F", 404, NOT_FOUND, []],
  ["GET", "/%68ealthz", 404, NOT_FOUND, []],
  ["GET", "/tiles", 404, NOT_FOUND, []],
  ["GET", "/tiles/", 404, TILE_NOT_FOUND, []],
  ["GET", "/tiles/styles/basemap.json/", 404, TILE_NOT_FOUND, []],
  ["GET", "/tiles/styles/extra/basemap.json", 404, TILE_NOT_FOUND, []],
  ["GET", "/TILES/styles/basemap.json", 404, NOT_FOUND, []],
  ["GET", "/tiles/STYLES/basemap.json", 404, TILE_NOT_FOUND, ["tiles tiles/STYLES/basemap.json"]],
  ["GET", "/tiles/styles%2Fbasemap.json", 404, TILE_NOT_FOUND, []],
  ["GET", "/tiles/styles/b%61semap.json", 200, '{"version":8}', ["tiles tiles/styles/basemap.json"]],
  ["GET", "/%74iles/styles/basemap.json", 404, NOT_FOUND, []],
  ["GET", "/img", 404, NOT_FOUND, []],
  ["GET", "/img/", 400, IMAGE_PATH_INVALID, []],
  ["GET", "/img/docs", 400, IMAGE_PATH_INVALID, []],
  ["GET", "/img/docs/", 400, IMAGE_PATH_INVALID, []],
  ["GET", "/img/docs/archive/a.png/", 400, IMAGE_PATH_INVALID, []],
  ["GET", "/img/docs/archive/extra/a.png", 404, IMAGE_NOT_FOUND, ["docs archive/extra/a.png"]],
  ["GET", "/IMG/docs/archive/a.png", 404, NOT_FOUND, []],
  ["GET", "/img/DOCS/archive/a.png", 400, IMAGE_PLAN_REQUIRED, []],
  ["GET", "/img/docs%2Farchive%2Fa.png", 400, IMAGE_PATH_INVALID, []],
  ["GET", "/img/docs/archive/%61.png", 400, IMAGE_PATH_INVALID, []],
  ["GET", "/%69mg/docs/archive/a.png", 404, NOT_FOUND, []],
  ["GET", "/img/a.jpg/?plan=h160", 400, IMAGE_PATH_INVALID, []],
  ["GET", "/img/x/a.jpg?plan=h160", 200, "jpeg-bytes", ["origin https://image.anitabi.cn/x/a.jpg?plan=h160"]],
  ["GET", "/IMG/a.jpg?plan=h160", 404, NOT_FOUND, []],
  ["GET", "/img/A.JPG?plan=h160", 200, "jpeg-bytes", ["origin https://image.anitabi.cn/A.JPG?plan=h160"]],
  ["GET", "/img/x%2Fa.jpg?plan=h160", 400, IMAGE_PATH_INVALID, []],
  ["GET", "/img/%61.jpg?plan=h160", 200, "jpeg-bytes", ["origin https://image.anitabi.cn/%61.jpg?plan=h160"]],
  ["GET", "/img/a.jpg", 400, IMAGE_PLAN_REQUIRED, []],
  ["GET", "/img/a.jpg?plan=full", 400, IMAGE_PLAN_REQUIRED, []],
  ["GET", "/catalog/public/popular/", 404, NOT_FOUND, []],
  ["GET", "/catalog/public/popular/x", 404, NOT_FOUND, []],
  ["GET", "/catalog/public/Popular", 404, NOT_FOUND, []],
  ["GET", "/catalog/public%2Fpopular", 404, NOT_FOUND, []],
  ["GET", "/catalog/public/%70opular", 404, NOT_FOUND, []],
  ["GET", "/catalog/public/anime-overview/3302/", 404, NOT_FOUND, []],
  ["GET", "/catalog/public/anime-overview/3302/x", 404, NOT_FOUND, []],
  ["GET", "/catalog/public/Anime-Overview/3302", 404, NOT_FOUND, []],
  ["GET", "/catalog/public/anime-overview/3302%2Fsecret", 404, NOT_FOUND, []],
  ["GET", "/catalog/public/anime-overview/%33302", 404, NOT_FOUND, []],
  ["GET", "/catalog/public/anime-overview/abc", 404, NOT_FOUND, []],
];

for (const [method, path, status, body, log] of NEIGHBOURS) {
  void test(`${method} ${path} answers ${String(status)}`, async (t) => {
    const seam = entrySeam(t);
    const response = await seam.send(method, path, HUMAN);
    assert.equal(response.status, status);
    assert.equal(await response.text(), body);
    assert.deepEqual(seam.log, log);
  });
}
