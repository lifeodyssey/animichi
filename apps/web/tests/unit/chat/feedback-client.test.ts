/**
 * @vitest-environment jsdom
 */
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { submitFeedback } from "../../../src/features/chat/feedback";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { server } from "../../msw/node";

const URL = `${TEST_ORIGIN}/v1/feedback`;

function capture(bodies: unknown[], headers: Headers[] = []): void {
  server.use(
    http.post(URL, async ({ request }) => {
      bodies.push(await request.json());
      headers.push(request.headers);
      return HttpResponse.json({ feedback_id: "fb-001" });
    }),
  );
}

describe("submitFeedback — transport (AGENT-3 #962)", () => {
  it("posts the feedback payload as JSON to /v1/feedback", async () => {
    const bodies: unknown[] = [];
    capture(bodies);
    const id = await submitFeedback(TEST_ORIGIN, {
      query_text: "京吹太棒了",
      rating: "good",
      intent: "search_bangumi",
    });
    expect(id).toBe("fb-001");
    expect(bodies[0]).toEqual({
      query_text: "京吹太棒了",
      rating: "good",
      intent: "search_bangumi",
    });
  });

  it("omits session_id from the body when absent", async () => {
    const bodies: unknown[] = [];
    capture(bodies);
    await submitFeedback(TEST_ORIGIN, { query_text: "hi", rating: "bad" });
    expect(bodies[0]).toEqual({ query_text: "hi", rating: "bad" });
  });

  it("sends the session id and content-type when present", async () => {
    const bodies: unknown[] = [];
    const headers: Headers[] = [];
    capture(bodies, headers);
    await submitFeedback(TEST_ORIGIN, {
      session_id: "sess-9",
      query_text: "hi",
      rating: "good",
    });
    expect(bodies[0]).toMatchObject({ session_id: "sess-9" });
    expect(headers[0]?.get("content-type")).toContain("application/json");
  });

  it("throws on a non-ok response", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ error: { code: "forbidden" } }, { status: 403 })));
    await expect(
      submitFeedback(TEST_ORIGIN, { query_text: "hi", rating: "good" }),
    ).rejects.toThrow("feedback responded 403");
  });

  it("throws on a malformed success body", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ nonsense: true })));
    await expect(
      submitFeedback(TEST_ORIGIN, { query_text: "hi", rating: "good" }),
    ).rejects.toThrow();
  });
});
