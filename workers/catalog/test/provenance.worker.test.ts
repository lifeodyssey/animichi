import { describe, expect, it } from "vitest";
import { pointFieldMap } from "../src/ingest/provenance";

describe("Point provenance field map (AC4)", () => {
  it("maps every published point field to the anitabi source", () => {
    const map = pointFieldMap();
    expect(map.id).toBe("anitabi");
    expect(map.name).toBe("anitabi");
    expect(map.latitude).toBe("anitabi");
    expect(map.longitude).toBe("anitabi");
    expect(map.image).toBe("anitabi");
  });

  it("includes each of the contributing point columns", () => {
    const map = pointFieldMap();
    expect(Object.keys(map).sort()).toEqual([
      "episode", "id", "image", "latitude", "longitude", "name", "name_cn", "time_seconds",
    ]);
  });
});
