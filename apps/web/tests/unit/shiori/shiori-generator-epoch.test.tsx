/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SanitizedShioriPhoto } from "../../../src/features/shiori/types";
import { ShioriGenerator, type ShioriGeneratorSource } from "../../../src/features/shiori/ShioriGenerator";
import { makeItinerary, makeMeta, makePhotoInput } from "./_factories";
import { blobText } from "./_jpegFixtures";

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

function makeSource(): ShioriGeneratorSource {
  return {
    meta: makeMeta(),
    itinerary: makeItinerary(),
    photos: [makePhotoInput()],
    checkedStopIds: ["stop-station", "stop-shrine"],
    isRouteDayOver: false,
  };
}

const lastPayload = (spy: ReturnType<typeof vi.fn>): readonly SanitizedShioriPhoto[] =>
  spy.mock.calls.at(-1)?.[0] as readonly SanitizedShioriPhoto[];

describe("ShioriGenerator EXIF policy epoch", () => {
  it("retires the old preview and export payload the moment the policy flips", async () => {
    const onPhotosSanitized = vi.fn();
    render(
      <ShioriGenerator source={makeSource()} locale="ja" onPhotosSanitized={onPhotosSanitized} />,
    );
    await screen.findByRole("img", { name: "気多若宮神社 の対比図" });

    fireEvent.click(screen.getByRole("checkbox", { name: "写真の位置情報（EXIF）を残す" }));

    expect(screen.queryByRole("img")).toBeNull();
    expect(lastPayload(onPhotosSanitized)).toEqual([]);
    await waitFor(async () => {
      expect(await blobText(lastPayload(onPhotosSanitized)[0]?.blob)).toContain("GPSLAT");
    });
  });

  it("revokes the previous epoch's object URL when the policy flips", async () => {
    render(<ShioriGenerator source={makeSource()} locale="ja" />);
    await screen.findByRole("img", { name: "気多若宮神社 の対比図" });

    fireEvent.click(screen.getByRole("checkbox", { name: "写真の位置情報（EXIF）を残す" }));

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });

  it("revokes URLs minted by an ingestion abandoned on unmount", async () => {
    const view = render(<ShioriGenerator source={makeSource()} locale="ja" />);

    view.unmount();

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    });
  });
});
