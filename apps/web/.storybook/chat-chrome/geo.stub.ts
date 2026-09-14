export type GeoPermission = Readonly<
  | { status: "granted"; lat: number; lng: number }
  | { status: "denied" }
>;

type GeoPlatform = Readonly<{ requestPermission: () => Promise<GeoPermission> }>;
const denied: GeoPlatform = { requestPermission: () => Promise.resolve({ status: "denied" }) };
let platform = denied;

export function setGeoPlatform(next: GeoPlatform): void {
  platform = next;
}

export function resetGeoPlatform(): void {
  platform = denied;
}

export function requestGeoPermission(): Promise<GeoPermission> {
  return platform.requestPermission();
}
