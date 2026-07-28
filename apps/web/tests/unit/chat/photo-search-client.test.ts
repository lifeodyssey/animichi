/**
 * @vitest-environment jsdom
 */
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { clearByokConfig, saveByokConfig } from "../../../src/lib/byok/byokStorage";
import {
  MAX_PHOTO_BYTES,
  confirmPhotoSearch,
  isOversizedPhoto,
  isSupportedPhoto,
  postPhotoSearch,
  toBase64,
} from "../../../src/features/chat/photo-search";
import type { PhotoSearchContext } from "../../../src/features/chat/photo-search";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { server } from "../../msw/node";
import { bytesToText, makeJpegWithExif } from "../shiori/_jpegFixtures";

afterEach(() => {
  clearByokConfig();
});

const URL = `${TEST_ORIGIN}/v1/photo-search`;
const CONFIRM_URL = `${TEST_ORIGIN}/v1/photo-search/confirm`;
const CTX: PhotoSearchContext = { locale: "ja" };
const OK = { success: true, status: "ok", intent: "clarify", data: {} };

function jpegFile(bytes: Uint8Array<ArrayBuffer> = makeJpegWithExif() as Uint8Array<ArrayBuffer>): File {
  return new File([bytes], "photo.jpg", { type: "image/jpeg" });
}

function capture(bodies: unknown[], headers: Headers[] = []) {
  server.use(
    http.post(URL, async ({ request }) => {
      bodies.push(await request.json());
      headers.push(request.headers);
      return HttpResponse.json(OK);
    }),
  );
}

describe("photo-search client", () => {
  it("accepts jpeg/png/webp and rejects everything else", () => {
    expect(isSupportedPhoto(jpegFile())).toBe(true);
    expect(isSupportedPhoto(new File([], "a.png", { type: "image/png" }))).toBe(true);
    expect(isSupportedPhoto(new File([], "a.gif", { type: "image/gif" }))).toBe(false);
  });

  it("flags files above the 8MB cap without reading them", () => {
    expect(isOversizedPhoto(jpegFile())).toBe(false);
    const big = new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "big.jpg", { type: "image/jpeg" });
    expect(isOversizedPhoto(big)).toBe(true);
  });

  it("base64-encodes payloads larger than one encoding chunk", async () => {
    const bytes = new Uint8Array(0x2000 + 7).fill(65);
    const encoded = await toBase64(new Blob([bytes]));
    expect(atob(encoded)).toBe("A".repeat(0x2000 + 7));
  });

});

describe("photo-search transport (P1-1/P1-4)", () => {
  it("strips EXIF (incl. GPS) before the image leaves the browser (P1-4)", async () => {
    const bodies: unknown[] = [];
    capture(bodies);
    const outcome = await postPhotoSearch(TEST_ORIGIN, jpegFile(), CTX);
    expect(outcome.kind).toBe("part");
    const sent = (bodies[0] as { image_base64: string; mime_type: string });
    expect(sent.mime_type).toBe("image/jpeg");
    const decoded = atob(sent.image_base64);
    expect(bytesToText(makeJpegWithExif())).toContain("GPSLAT35.68");
    expect(decoded).not.toContain("GPSLAT35.68");
    expect(decoded.startsWith("\xff\xd8")).toBe(true);
  });

  it("sends the session headers plus x-locale (P1-1 transport)", async () => {
    const headers: Headers[] = [];
    capture([], headers);
    const ctx: PhotoSearchContext = { locale: "zh", sessionIdOf: () => "sess-9" };
    await postPhotoSearch(TEST_ORIGIN, jpegFile(), ctx);
    expect(headers[0]?.get("x-locale")).toBe("zh");
    expect(headers[0]?.get("x-session-id")).toBe("sess-9");
    expect(headers[0]?.get("content-type")).toBe("application/json");
  });

  it("includes gps only when the context provides it", async () => {
    const bodies: unknown[] = [];
    capture(bodies);
    await postPhotoSearch(TEST_ORIGIN, jpegFile(), { ...CTX, gps: { lat: 35.2, lng: 136.2 } });
    await postPhotoSearch(TEST_ORIGIN, jpegFile(), CTX);
    expect(bodies[0]).toMatchObject({ gps: { lat: 35.2, lng: 136.2 } });
    expect(bodies[1]).not.toHaveProperty("gps");
  });

});

describe("BYOK headers on photo search (#284 P1-2 — deliberate, not inherited by accident)", () => {
  // Ruling: photo search sharing `sessionHeaders()` with chat means a saved
  // BYOK credential's headers reach the vision turn too. This is the
  // *correct* semantics, not a side effect to suppress — the vision
  // probe/badge (Task 5, D5) exists precisely so a BYOK user's image turns
  // are answered by their own key, and T9 requires a BYOK turn to never
  // silently fall back to the platform key. Photo search is a BYOK turn
  // like any other, so it must carry the same headers chat does.
  it("carries the full X-BYOK-* set on the upload request", async () => {
    saveByokConfig({
      provider: "openai-compatible",
      apiKey: "sk-vision-key",
      model: "gpt-5-vision",
      baseUrl: "https://api.example.com/v1",
    });
    const headers: Headers[] = [];
    capture([], headers);
    await postPhotoSearch(TEST_ORIGIN, jpegFile(), CTX);
    expect(headers[0]?.get("x-byok-provider")).toBe("openai-compatible");
    expect(headers[0]?.get("x-byok-key")).toBe("sk-vision-key");
    expect(headers[0]?.get("x-byok-model")).toBe("gpt-5-vision");
    expect(headers[0]?.get("x-byok-base-url")).toBe("https://api.example.com/v1");
  });

  it("carries no X-BYOK-* headers when nothing is saved", async () => {
    const headers: Headers[] = [];
    capture([], headers);
    await postPhotoSearch(TEST_ORIGIN, jpegFile(), CTX);
    expect(headers[0]?.get("x-byok-provider")).toBeNull();
  });
});

describe("photo-search outcomes", () => {
  it("defaults a malformed 429 body to the configure-key guidance", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ nonsense: true }, { status: 429 })));
    const outcome = await postPhotoSearch(TEST_ORIGIN, jpegFile(), CTX);
    expect(outcome).toEqual({ kind: "quota", guidance: "configure_vision_key" });
  });

  it("throws on a non-ok response", async () => {
    server.use(http.post(URL, () => HttpResponse.json({}, { status: 500 })));
    await expect(postPhotoSearch(TEST_ORIGIN, jpegFile(), CTX)).rejects.toThrow("photo_search_failed");
  });

  it("the confirm ping carries the same identity headers", async () => {
    const headers: Headers[] = [];
    server.use(
      http.post(CONFIRM_URL, ({ request }) => {
        headers.push(request.headers);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    confirmPhotoSearch(
      TEST_ORIGIN,
      { query_type: "anime_screenshot", gps_available: false, layer_hit: "none", candidates_shown: 0 },
      { locale: "en", sessionIdOf: () => "sess-1" },
    );
    await expect.poll(() => headers.length).toBe(1);
    expect(headers[0]?.get("x-locale")).toBe("en");
    expect(headers[0]?.get("x-session-id")).toBe("sess-1");
  });
});
