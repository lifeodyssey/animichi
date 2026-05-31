/**
 * Tests for lib/api/feedback.ts, lib/api/routes.ts, lib/api/guide.ts
 *
 * Uses global.fetch mocking (same pattern as conversation-api.test.ts).
 * MSW is running but these tests override fetch directly for fine-grained control.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { server } from "./mocks/server";
import { http, HttpResponse } from "msw";

// Set env before module imports
process.env.NEXT_PUBLIC_RUNTIME_URL = "http://localhost:8000";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

const BASE = "http://localhost:8000";

// ──────────────────────────────────────────────
// feedback.ts
// ──────────────────────────────────────────────
describe("submitFeedback", () => {
  it("sends a POST to /v1/feedback and returns feedback_id", async () => {
    server.use(
      http.post(`${BASE}/v1/feedback`, () =>
        HttpResponse.json({ feedback_id: "fb-xyz" }),
      ),
    );
    const { submitFeedback } = await import("@/lib/api/feedback");
    const result = await submitFeedback({
      session_id: "sess-1",
      query_text: "宇治の聖地",
      intent: "search_bangumi",
      rating: "good",
    });
    expect(result).toEqual({ feedback_id: "fb-xyz" });
  });

  it("throws when the server responds with an error status", async () => {
    server.use(
      http.post(`${BASE}/v1/feedback`, () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );
    const { submitFeedback } = await import("@/lib/api/feedback");
    await expect(
      submitFeedback({
        session_id: null,
        query_text: "test",
        intent: "search_bangumi",
        rating: "bad",
      }),
    ).rejects.toThrow("Feedback submission failed (500)");
  });

  it("includes optional comment in the request body", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/v1/feedback`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ feedback_id: "fb-comment" });
      }),
    );
    const { submitFeedback } = await import("@/lib/api/feedback");
    await submitFeedback({
      session_id: "s",
      query_text: "q",
      intent: "search_bangumi",
      rating: "bad",
      comment: "間違い情報",
    });
    expect(body.comment).toBe("間違い情報");
  });
});

// ──────────────────────────────────────────────
// routes.ts
// ──────────────────────────────────────────────
describe("fetchRouteHistory", () => {
  beforeEach(async () => {
    // Reset supabase session mock
    const { createClient } = await import("@/lib/supabase/browser");
    const sb = createClient();
    if (sb) {
      Object.defineProperty(sb.auth, "getSession", {
        configurable: true,
        value: async () => ({ data: { session: { access_token: "tok-routes" } } }),
      });
    }
  });

  it("returns route history from /v1/routes", async () => {
    const routes = [
      {
        id: "r-1",
        bangumi_id: "bg-1",
        bangumi_title: "ゆるキャン",
        origin_station: "富士山駅",
        point_count: 5,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    server.use(
      http.get(`${BASE}/v1/routes`, () =>
        HttpResponse.json({ routes }),
      ),
    );
    const { fetchRouteHistory } = await import("@/lib/api/routes");
    const result = await fetchRouteHistory();
    expect(result).toEqual(routes);
  });

  it("returns empty array when server responds with error", async () => {
    server.use(
      http.get(`${BASE}/v1/routes`, () =>
        new HttpResponse(null, { status: 403 }),
      ),
    );
    const { fetchRouteHistory } = await import("@/lib/api/routes");
    const result = await fetchRouteHistory();
    expect(result).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// guide.ts
// ──────────────────────────────────────────────
describe("fetchAnimeGuide", () => {
  const guideData = {
    bangumi_id: "bg-1",
    title: "ゆるキャン△",
    title_cn: "摇曳露营",
    cover_url: "https://example.com/cover.jpg",
    city: "富士宮市",
    spot_count: 3,
    spots: [],
    bounds: null,
  };

  it("returns guide data for a valid bangumi id", async () => {
    server.use(
      http.get(`${BASE}/v1/bangumi/:id/guide`, () =>
        HttpResponse.json(guideData),
      ),
    );
    const { fetchAnimeGuide } = await import("@/lib/api/guide");
    const result = await fetchAnimeGuide("bg-1");
    expect(result?.bangumi_id).toBe("bg-1");
    expect(result?.title).toBe("ゆるキャン△");
  });

  it("returns null when the anime guide is not found (404)", async () => {
    server.use(
      http.get(`${BASE}/v1/bangumi/:id/guide`, () =>
        new HttpResponse(null, { status: 404 }),
      ),
    );
    const { fetchAnimeGuide } = await import("@/lib/api/guide");
    const result = await fetchAnimeGuide("no-such-id");
    expect(result).toBeNull();
  });

  it("throws when the server returns a non-404 error", async () => {
    server.use(
      http.get(`${BASE}/v1/bangumi/:id/guide`, () =>
        new HttpResponse(null, { status: 503 }),
      ),
    );
    const { fetchAnimeGuide } = await import("@/lib/api/guide");
    await expect(fetchAnimeGuide("bg-1")).rejects.toThrow(
      "Guide fetch failed (503)",
    );
  });

  it("appends locale query param when provided", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/v1/bangumi/:id/guide`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(guideData);
      }),
    );
    const { fetchAnimeGuide } = await import("@/lib/api/guide");
    await fetchAnimeGuide("bg-1", "en");
    expect(capturedUrl).toContain("locale=en");
  });
});
