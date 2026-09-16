import { http, HttpResponse } from "msw";
import type { HttpHandler } from "msw";
import { TEST_ORIGIN } from "./fixtures";

/**
 * MSW swimlane for the catalog `GET /catalog/public/popular` endpoint
 * (`catalogContract.popular`; the fixture mirrors its `{ bangumi: [...] }`
 * output). The hook sends the contract's declared `limit` query parameter
 * (`?limit=8`), which the edge gateway and the catalog Worker both accept from
 * the one allowlist in `@animichi/contract/public-catalog` (#1691). MSW matches
 * on the path, so the query does not appear in `POPULAR_URL`.
 */
export const POPULAR_URL = `${TEST_ORIGIN}/catalog/public/popular`;

export const popularFixture = {
  bangumi: [
    { bangumi_id: "1", title: "Your Name", title_cn: "你的名字", cover_url: "https://cdn.test/1.jpg", city: "Tokyo", points_count: 12, rating: 9.1 },
    { bangumi_id: "2", title: "Euphonium", title_cn: "吹响吧！上低音号", cover_url: null, city: "Uji", points_count: 8, rating: 8.4 },
  ],
} as const;

export const popularHandler: HttpHandler = http.get(POPULAR_URL, () =>
  HttpResponse.json(popularFixture),
);

export const popularEmptyHandler: HttpHandler = http.get(POPULAR_URL, () =>
  HttpResponse.json({ bangumi: [] }),
);

export const popularErrorHandler: HttpHandler = http.get(POPULAR_URL, () =>
  HttpResponse.json({ detail: "boom" }, { status: 500 }),
);
