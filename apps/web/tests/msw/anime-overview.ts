import { http, HttpResponse } from "msw";
import type { HttpHandler, JsonBodyType } from "msw";
import { AnimeOverview, AnimeOverviewInput } from "@seichijunrei/contract";
import { orpcErrorResponse } from "./contract-handler";
import { TEST_ORIGIN } from "./fixtures";

/**
 * Contract-typed MSW swimlane for the public `catalog.animeOverview` GET route.
 *
 * Same discipline as `contract-handler.ts`, adapted to a GET with a path
 * param: the path segment is `parse()`d with the contract input schema and
 * every body is `parse()`d with the output schema — no hand-written JSON.
 */
export const ANIME_OVERVIEW_PATH = `${TEST_ORIGIN}/catalog/public/anime-overview/:bangumi_id`;

/** A known anime with spots across three cities; circles arrive unsorted. */
export const fullOverviewFixture = {
  bangumi_id: "123",
  points_length: 6,
  circles: [
    { region: "Tokyo", count: 2, lat: 35.6812, lng: 139.7671 },
    { region: "Takayama", count: 3, lat: 36.1408, lng: 137.2521 },
    { region: "Hida", count: 1, lat: 36.2381, lng: 137.1863 },
  ],
  scenes: [
    {
      id: "scene-2",
      name: "Hida Furukawa Station",
      screenshot_url: "https://cdn.test/scene-2.jpg",
      shot_count: 2,
      lat: 36.2381,
      lng: 137.1863,
      city: "Hida",
    },
    {
      id: "scene-1",
      name: "Suga Shrine Stairs",
      screenshot_url: "https://cdn.test/scene-1.jpg",
      shot_count: 5,
      lat: 35.6852,
      lng: 139.7195,
      city: "Tokyo",
    },
  ],
  sample_routes: [
    { region: "Takayama", point_ids: ["p1", "p2", "p3"] },
    { region: "Tokyo", point_ids: ["p4", "p5"] },
  ],
} satisfies AnimeOverview;

/** A cataloged id with zero pilgrimage spots: empty-but-valid, per contract. */
export function emptyOverviewFixture(bangumiId: string): AnimeOverview {
  return {
    bangumi_id: bangumiId,
    points_length: 0,
    circles: [],
    scenes: [],
    sample_routes: [],
  };
}

function overviewFor(bangumiId: string): AnimeOverview {
  return bangumiId === fullOverviewFixture.bangumi_id
    ? fullOverviewFixture
    : emptyOverviewFixture(bangumiId);
}

function respond(rawId: string | readonly string[] | undefined): HttpResponse<JsonBodyType> {
  const parsed = AnimeOverviewInput.safeParse({ bangumi_id: rawId });
  if (!parsed.success) {
    return orpcErrorResponse({ code: "BAD_REQUEST", status: 400, message: parsed.error.message });
  }
  const body = AnimeOverview.parse(overviewFor(parsed.data.bangumi_id));
  return HttpResponse.json(body as JsonBodyType);
}

/** Default handler: the fixture anime for "123", empty-but-valid otherwise. */
export const animeOverviewHandler: HttpHandler = http.get(ANIME_OVERVIEW_PATH, ({ params }) =>
  respond(params.bangumi_id),
);

/** A catalog that 404s every id, as it will for unknown works (WORK_NOT_FOUND). */
export const animeOverviewNotFoundHandler: HttpHandler = http.get(ANIME_OVERVIEW_PATH, () =>
  orpcErrorResponse({
    code: "WORK_NOT_FOUND",
    status: 404,
    message: "No pilgrimage points for this work",
  }),
);

/** A generic gateway 404 (HTML, no typed envelope): NOT an unknown work. */
export const animeOverviewGatewayNotFoundHandler: HttpHandler = http.get(
  ANIME_OVERVIEW_PATH,
  () =>
    new HttpResponse("<html><body>404 Not Found</body></html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    }),
);

/** An always-failing handler for loader error-path tests. */
export const animeOverviewOutageHandler: HttpHandler = http.get(ANIME_OVERVIEW_PATH, () =>
  orpcErrorResponse({ code: "INTERNAL_SERVER_ERROR", status: 500, message: "catalog unavailable" }),
);
