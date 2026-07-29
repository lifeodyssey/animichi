/**
 * X10 platform adaptation layer for geolocation (issue #260 AC8).
 *
 * UI code calls `requestGeoPermission()` — never `navigator.geolocation`
 * directly — so the Capacitor build can swap the implementation with
 * `setGeoPlatform` at bootstrap without touching any component.
 */

export type GeoPermission =
  | { readonly status: "granted"; readonly lat: number; readonly lng: number }
  | { readonly status: "denied" };

export interface GeoPlatform {
  readonly requestPermission: () => Promise<GeoPermission>;
}

const DENIED: GeoPermission = { status: "denied" };

function fromPosition(position: GeolocationPosition): GeoPermission {
  return {
    status: "granted",
    lat: position.coords.latitude,
    lng: position.coords.longitude,
  };
}

function requestFromBrowser(resolve: (permission: GeoPermission) => void): void {
  if (!("geolocation" in navigator)) {
    resolve(DENIED);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => { resolve(fromPosition(position)); },
    () => { resolve(DENIED); },
  );
}

/** Default web implementation; native shells override it via setGeoPlatform. */
const webGeoPlatform: GeoPlatform = {
  requestPermission: () => new Promise(requestFromBrowser),
};

let activePlatform: GeoPlatform = webGeoPlatform;

export function setGeoPlatform(platform: GeoPlatform): void {
  activePlatform = platform;
}

export function resetGeoPlatform(): void {
  activePlatform = webGeoPlatform;
}

/** The only geolocation entry point components may use (X10). */
export function requestGeoPermission(): Promise<GeoPermission> {
  return activePlatform.requestPermission();
}
