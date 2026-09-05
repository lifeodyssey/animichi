/**
 * @vitest-environment jsdom
 */
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmPhotoSearch } from "../../../src/features/chat/photo-search";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { server } from "../../msw/node";

/**
 * The confirmation's failure lane (web-M9). A lost confirm costs the SD-26
 * `user_confirmed` signal, never the visitor's turn, so it earns an operator
 * record rather than a D-state — but it must not vanish, which is what the
 * old `.catch(() => undefined)` did.
 */

const CONFIRM_URL = `${TEST_ORIGIN}/v1/photo-search/confirm`;
const CTX = { locale: "en" } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function watchOperatorConsole() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

function record(offerId: string, reason: string): string {
  return JSON.stringify({ event: "photo_offer_confirm_failed", offer_id: offerId, reason });
}

describe("photo offer confirmation failures are recorded, not swallowed (web-M9)", () => {
  // Both halves of `!response.ok` are pinned: a refused offer id loses the
  // signal exactly as a crashed backend does, so neither may narrow away.
  it.each([400, 500])("records a confirmation the server refused with %i", async (status) => {
    const warn = watchOperatorConsole();
    server.use(http.post(CONFIRM_URL, () => new HttpResponse(null, { status })));
    confirmPhotoSearch(TEST_ORIGIN, "offer-7", "9912", CTX);
    await expect.poll(() => warn.mock.calls.length).toBe(1);
    expect(warn.mock.calls[0]?.[0]).toBe(record("offer-7", String(status)));
  });

  it("records a confirmation that never reached the server", async () => {
    const warn = watchOperatorConsole();
    server.use(http.post(CONFIRM_URL, () => HttpResponse.error()));
    confirmPhotoSearch(TEST_ORIGIN, "offer-7", undefined, CTX);
    await expect.poll(() => warn.mock.calls.length).toBe(1);
    expect(warn.mock.calls[0]?.[0]).toBe(record("offer-7", "unreachable"));
  });

  it("stays quiet when the confirmation lands", async () => {
    const warn = watchOperatorConsole();
    const landed: unknown[] = [];
    server.use(http.post(CONFIRM_URL, async ({ request }) => {
      landed.push(await request.json());
      return new HttpResponse(null, { status: 204 });
    }));
    confirmPhotoSearch(TEST_ORIGIN, "offer-7", "9912", CTX);
    await expect.poll(() => landed.length).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
