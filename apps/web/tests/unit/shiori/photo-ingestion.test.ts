import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestShioriPhotos, revokeShioriPhotoUrls } from "../../../src/features/shiori/photoIngestion";
import { makePhotoInput } from "./_factories";
import { blobText, makeMalformedJpegBlob } from "./_jpegFixtures";

const createObjectURL = vi.fn((_blob: Blob) => `blob:mock-${String(createObjectURL.mock.calls.length)}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ingestShioriPhotos", () => {
  it("sanitizes every blob before minting the render URL", async () => {
    const photos = await ingestShioriPhotos([makePhotoInput()]);

    expect(photos).toHaveLength(1);
    expect(photos[0]?.imageUrl).toBe("blob:mock-1");
    expect(createObjectURL).toHaveBeenCalledWith(photos[0]?.blob);
    expect(await blobText(photos[0]?.blob)).not.toContain("GPSLAT");
  });

  it("keeps the display fields from the input", async () => {
    const photos = await ingestShioriPhotos([makePhotoInput({ id: "photo-9", spotName: "駅前" })]);

    expect(photos[0]).toMatchObject({
      id: "photo-9",
      spotName: "駅前",
      sceneLabel: "第8話 41:12",
      capturedAt: "10:48",
    });
  });

  it("excludes a malformed photo instead of passing it through", async () => {
    const malformed = makePhotoInput({ id: "photo-bad", photo: makeMalformedJpegBlob() });

    const photos = await ingestShioriPhotos([malformed, makePhotoInput({ id: "photo-ok" })]);

    expect(photos.map((photo) => photo.id)).toEqual(["photo-ok"]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("routes an explicit EXIF opt-in through the same boundary", async () => {
    const input = makePhotoInput();

    const photos = await ingestShioriPhotos([input], { retainExif: true });

    expect(photos[0]?.blob).toBe(input.photo);
    expect(photos[0]?.imageUrl).toBe("blob:mock-1");
  });
});

describe("revokeShioriPhotoUrls", () => {
  it("revokes the object URL of every photo", async () => {
    const photos = await ingestShioriPhotos([makePhotoInput(), makePhotoInput({ id: "photo-2" })]);

    revokeShioriPhotoUrls(photos);

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-2");
  });
});
