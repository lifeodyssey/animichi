export interface GeographyPoint<Srid extends number = number> {
  readonly type: "Point";
  readonly coordinates: readonly [number, number];
  readonly srid: Srid;
}

export function geographyPoint(longitude: number, latitude: number): GeographyPoint<4326>;
export function geographyPoint<const Srid extends number>(
  longitude: number,
  latitude: number,
  srid: Srid,
): GeographyPoint<Srid>;
export function geographyPoint(longitude: number, latitude: number, srid = 4326): GeographyPoint {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new TypeError("geographyPoint: coordinates must be finite numbers");
  }
  if (!Number.isInteger(srid) || srid < 0) {
    throw new TypeError("geographyPoint: srid must be a non-negative integer");
  }
  return { type: "Point", coordinates: [longitude, latitude], srid };
}
