/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SanitizedShioriPhoto } from "../../../src/features/shiori/types";
import { ShioriGenerator, type ShioriGeneratorSource } from "../../../src/features/shiori/ShioriGenerator";
import { makeItinerary, makeMeta, makePhotoInput } from "./_factories";
import { blobText, makeMalformedJpegBlob } from "./_jpegFixtures";

const createObjectURL = vi.fn((_blob: Blob) => `blob:mock-${String(createObjectURL.mock.calls.length)}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function makeCompletedSource(photos: ShioriGeneratorSource["photos"]): ShioriGeneratorSource {
  return {
    meta: makeMeta(),
    itinerary: makeItinerary(),
    photos,
    checkedStopIds: ["stop-station", "stop-shrine"],
    isRouteDayOver: false,
  };
}

const lastPayload = (spy: ReturnType<typeof vi.fn>): readonly SanitizedShioriPhoto[] =>
  spy.mock.calls.at(-1)?.[0] as readonly SanitizedShioriPhoto[];

describe("ShioriGenerator EXIF pipeline", () => {
  it("renders photos only from sanitized bytes and exports EXIF-free blobs", async () => {
    const onPhotosSanitized = vi.fn();
    render(
      <ShioriGenerator
        source={makeCompletedSource([makePhotoInput()])}
        locale="ja"
        onPhotosSanitized={onPhotosSanitized}
      />,
    );

    const image = await screen.findByRole("img", { name: "気多若宮神社 の対比図" });
    expect(image.getAttribute("src")).toBe("blob:mock-1");
    const payload = lastPayload(onPhotosSanitized);
    expect(payload).toHaveLength(1);
    expect(await blobText(payload[0]?.blob)).not.toContain("Exif");
    expect(await blobText(payload[0]?.blob)).not.toContain("GPSLAT");
  });

  it("excludes a malformed photo instead of rendering its raw bytes", async () => {
    const onPhotosSanitized = vi.fn();
    const malformed = makePhotoInput({ photo: makeMalformedJpegBlob() });
    render(
      <ShioriGenerator
        source={makeCompletedSource([malformed])}
        locale="ja"
        onPhotosSanitized={onPhotosSanitized}
      />,
    );

    await waitFor(() => {
      expect(onPhotosSanitized).toHaveBeenCalled();
    });
    expect(lastPayload(onPhotosSanitized)).toHaveLength(0);
    expect(screen.queryByRole("img")).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("re-ingests with the original bytes only after the user opts in", async () => {
    const onPhotosSanitized = vi.fn();
    render(
      <ShioriGenerator
        source={makeCompletedSource([makePhotoInput()])}
        locale="ja"
        onPhotosSanitized={onPhotosSanitized}
      />,
    );
    await screen.findByRole("img", { name: "気多若宮神社 の対比図" });

    fireEvent.click(screen.getByRole("checkbox", { name: "写真の位置情報（EXIF）を残す" }));

    await waitFor(async () => {
      expect(await blobText(lastPayload(onPhotosSanitized)[0]?.blob)).toContain("GPSLAT");
    });
  });
});
