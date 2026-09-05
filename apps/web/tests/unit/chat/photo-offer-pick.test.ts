/**
 * @vitest-environment jsdom
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { photoOfferPick } from "../../../src/features/chat/selection/photo-offer-pick";
import type { PhotoOffer } from "../../../src/features/chat/selection/photo-offer-pick";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { server } from "../../msw/node";

/**
 * The photo offer's candidate-pick channel (#1336). Its contract toward the
 * clarify card: it always takes an id-carrying candidate, it confirms the
 * offer rather than answering a session clarification, and it owns no retry
 * state — the continuation is an ordinary turn.
 */

const CONFIRM_URL = `${TEST_ORIGIN}/v1/photo-search/confirm`;
const KEION = "けいおん!";

function makePhotoOffer(): PhotoOffer {
  return { baseUrl: TEST_ORIGIN, offerId: "offer-7", context: { locale: "en" } };
}

function recordConfirms(confirmed: unknown[]) {
  server.use(http.post(CONFIRM_URL, async ({ request }) => {
    confirmed.push(await request.json());
    return new HttpResponse(null, { status: 204 });
  }));
}

describe("the photo offer's own pick channel (#1336)", () => {
  it("confirms the offer, then asks the conversation about the chosen title", async () => {
    const confirmed: unknown[] = [];
    recordConfirms(confirmed);
    const send = vi.fn();
    photoOfferPick(makePhotoOffer(), send, true).pick({ candidateId: "9912", label: KEION, clarificationId: undefined });
    expect(send).toHaveBeenCalledExactlyOnceWith(KEION);
    await expect.poll(() => confirmed.length).toBe(1);
    expect(confirmed[0]).toEqual({ offer_id: "offer-7", candidate_id: "9912" });
  });

  it("always takes the pick, and carries the page's own send gate", () => {
    const gated = photoOfferPick(makePhotoOffer(), vi.fn(), false);
    expect(gated.enabled).toBe(true);
    expect(gated.sendable).toBe(false);
  });

  it("holds no retry state, so resending it does nothing", () => {
    const send = vi.fn();
    const turn = photoOfferPick(makePhotoOffer(), send, true);
    expect(turn.status).toBe("idle");
    expect(turn.lastPick).toBeUndefined();
    turn.resend();
    expect(send).not.toHaveBeenCalled();
  });
});
