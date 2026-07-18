import { describe, expect, it } from "vitest";
import { createMapStyle } from "../../src/features/map-spike/mapStyle";

const source = (style: ReturnType<typeof createMapStyle>) => {
  return style.sources.protomaps;
};

describe("createMapStyle", () => {
  it("emits a version-8 style with a protomaps source and Japanese label layers", () => {
    const style = createMapStyle("pmtiles");
    expect(style.version).toBe(8);
    expect(style.layers.length).toBeGreaterThan(0);
    expect(source(style)).toBeDefined();
  });

  it("references the pmtiles archive via the pmtiles:// protocol by default", () => {
    const built = source(createMapStyle("pmtiles"));
    expect(built).toMatchObject({ type: "vector", url: "pmtiles:///tiles/uji-kyoto.pmtiles" });
  });

  it("points the worker mode at the ZXY endpoint instead", () => {
    const built = source(createMapStyle("worker"));
    expect(built).toMatchObject({ type: "vector", tiles: ["/tiles/{z}/{x}/{y}.mvt"] });
  });

  it("honors a custom pmtiles path for bbox-coverage checks", () => {
    const built = source(createMapStyle("pmtiles", "/tiles/missing.pmtiles"));
    expect(built).toMatchObject({ url: "pmtiles:///tiles/missing.pmtiles" });
  });
});
