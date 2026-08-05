import type { NeonSql } from "../db/client";
import { sql } from "drizzle-orm";

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
  latitude: r.latitude,
  longitude: r.longitude,
  distanceM: r.distance_m,
});

/** Hard ceiling on the searched radius; larger requests are clamped, not rejected. */
export const MAX_RADIUS_M = 50_000;
const MAX_RESULTS = 200;

/** Points within `radiusM` meters of (lat,lng), nearest first, with `distanceM`. */
export async function findPointsWithinRadius(
  neonSql: NeonSql,
  q: NearbyQuery,
): Promise<NearbyPoint[]> {
  const { lat, lng } = q;
  const radius = Math.min(q.radiusM, MAX_RADIUS_M);
  const rows = await nearbyRadiusQuery(neonSql, lat, lng, radius);
  return (rows as unknown as NearbyRow[]).map(toPoint);
}

function nearbyRadiusQuery(neonSql: NeonSql, lat: number, lng: number, radiusM: number) {
  const geoPoint = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
  return neonSql`
    SELECT id, name, latitude, longitude, ST_Distance(location, ${geoPoint}) AS distance_m
    FROM points
    WHERE ST_DWithin(location, ${geoPoint}, ${radiusM})
    ORDER BY location <-> ${geoPoint}
    LIMIT ${MAX_RESULTS}
  `;
}
