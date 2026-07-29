import { http, HttpResponse } from "msw";
import type { HttpHandler } from "msw";
import { TEST_ORIGIN } from "./fixtures";

/**
 * MSW swimlane for the existing agent-side `GET /v1/bangumi/popular` endpoint
 * (spec S5.5: an existing public endpoint this train does not migrate, so it
 * has no oRPC contract — the fixtures mirror its `{ bangumi: [...] }` shape).
 */
export const POPULAR_URL = `${TEST_ORIGIN}/v1/bangumi/popular`;

export const popularFixture = {
  bangumi: [
    { id: "1", title: "Your Name", title_cn: "你的名字", cover_url: "https://cdn.test/1.jpg", city: "Tokyo", points_count: 12, rating: 9.1 },
    { id: "2", title: "Euphonium", title_cn: "吹响吧！上低音号", cover_url: null, city: "Uji", points_count: 8, rating: 8.4 },
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
