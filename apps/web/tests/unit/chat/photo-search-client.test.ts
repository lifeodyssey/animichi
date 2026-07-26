/**
 * @vitest-environment jsdom
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  isSupportedPhoto,
  postPhotoSearch,
  toBase64,
} from "../../../src/features/chat/photo-search";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { server } from "../../msw/node";

const URL = `${TEST_ORIGIN}/v1/photo-search`;

function jpegFile(bytes: Uint8Array<ArrayBuffer>): File {
  return new File([bytes], "photo.jpg", { type: "image/jpeg" });
}

describe("photo-search client", () => {
  it("accepts jpeg/png/webp and rejects everything else", () => {
    expect(isSupportedPhoto(jpegFile(new Uint8Array([1])))).toBe(true);
    expect(isSupportedPhoto(new File([], "a.png", { type: "image/png" }))).toBe(true);
    expect(isSupportedPhoto(new File([], "a.gif", { type: "image/gif" }))).toBe(false);
  });

  it("base64-encodes payloads larger than one encoding chunk", async () => {
    const bytes = new Uint8Array(0x2000 + 7).fill(65);
    const encoded = await toBase64(jpegFile(bytes));
    expect(atob(encoded)).toBe("A".repeat(0x2000 + 7));
  });

  it("posts the encoded image and mime type", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(URL, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ success: true, status: "ok", intent: "clarify", data: {} });
      }),
    );
    const outcome = await postPhotoSearch(TEST_ORIGIN, jpegFile(new Uint8Array([1, 2])));
    expect(outcome.kind).toBe("part");
    expect(bodies[0]).toEqual({ image_base64: btoa("\x01\x02"), mime_type: "image/jpeg" });
  });

  it("includes gps only when provided", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(URL, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ success: true, status: "ok", intent: "clarify", data: {} });
      }),
    );
    await postPhotoSearch(TEST_ORIGIN, jpegFile(new Uint8Array([1])), { lat: 35.2, lng: 136.2 });
    expect(bodies[0]).toMatchObject({ gps: { lat: 35.2, lng: 136.2 } });
  });

  it("defaults a malformed 429 body to the configure-key guidance", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ nonsense: true }, { status: 429 })));
    const outcome = await postPhotoSearch(TEST_ORIGIN, jpegFile(new Uint8Array([1])));
    expect(outcome).toEqual({ kind: "quota", guidance: "configure_vision_key" });
  });

  it("throws on a non-ok response", async () => {
    server.use(http.post(URL, () => HttpResponse.json({}, { status: 500 })));
    await expect(postPhotoSearch(TEST_ORIGIN, jpegFile(new Uint8Array([1])))).rejects.toThrow("photo_search_failed");
  });
});
