/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestGeoPermission,
  resetGeoPlatform,
  setGeoPlatform,
} from "../../src/platform/geo";

afterEach(() => {
  resetGeoPlatform();
  vi.unstubAllGlobals();
});

type PositionCallback = (position: GeolocationPosition) => void;
type ErrorCallback = () => void;

function stubGeolocation(impl: (ok: PositionCallback, fail: ErrorCallback) => void) {
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: impl } });
}

const POSITION = { coords: { latitude: 34.9, longitude: 135.8 } } as GeolocationPosition;

describe("platform geo adapter (X10)", () => {
  it("routes through an injected platform implementation", async () => {
    const requestPermission = vi.fn().mockResolvedValue({ status: "granted", lat: 1, lng: 2 });
    setGeoPlatform({ requestPermission });
    const permission = await requestGeoPermission();
    expect(permission).toEqual({ status: "granted", lat: 1, lng: 2 });
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("maps a browser position to granted coordinates", async () => {
    stubGeolocation((ok) => { ok(POSITION); });
    const permission = await requestGeoPermission();
    expect(permission).toEqual({ status: "granted", lat: 34.9, lng: 135.8 });
  });

  it("maps a browser rejection to denied", async () => {
    stubGeolocation((_ok, fail) => { fail(); });
    const permission = await requestGeoPermission();
    expect(permission).toEqual({ status: "denied" });
  });

  it("degrades to denied when the browser has no geolocation", async () => {
    vi.stubGlobal("navigator", {});
    const permission = await requestGeoPermission();
    expect(permission).toEqual({ status: "denied" });
  });
});
