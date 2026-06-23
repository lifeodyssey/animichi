import type { NeonSql } from "../db/client";

export interface NearbyQuery {
  lat: number;
  lng: number;
  radiusM: number;
}

export interface NearbyPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceM: number;
}

interface NearbyRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distance_m: number;
}

const toPoint = (r: NearbyRow): NearbyPoint => ({
  id: r.id,
  name: r.name,
  latitude: Number(r.latitude),
  longitude: Number(r.longitude),
  distanceM: Number(r.distance_m),
});

const MAX_RADIUS_M = 50_000;
const MAX_RESULTS = 200;

/** Points within `radiusM` meters of (lat,lng), nearest first, with `distanceM`. */
export async function findPointsWithinRadius(
  neonSql: NeonSql,
  q: NearbyQuery,
): Promise<NearbyPoint[]> {
  const { lat, lng } = q;
  const clampedRadius = Math.min(q.radiusM, MAX_RADIUS_M);
  const rows = await neonSql`
    SELECT id, name, latitude, longitude, ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance_m
    FROM points
    WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${clampedRadius})
    ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
    LIMIT ${MAX_RESULTS}
  `;
  return (rows as unknown as NearbyRow[]).map(toPoint);
}
