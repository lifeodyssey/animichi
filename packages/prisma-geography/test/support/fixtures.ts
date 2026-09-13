import { geographyPoint } from "../../src/geography/geojson.ts";

export const TOKYO_STATION = geographyPoint(139.7671, 35.6812);
export const RADIUS_METERS = 30_000;
export const EXPECTED_NEAREST = ["marunouchi", "shibuya", "yokohama"] as const;

export const KNOWN_POINTS = [
  { id: "osaka", name: "Osaka", location: geographyPoint(135.5023, 34.6937) },
  { id: "yokohama", name: "Yokohama", location: geographyPoint(139.622, 35.466) },
  { id: "shibuya", name: "Shibuya", location: geographyPoint(139.7016, 35.658) },
  { id: "marunouchi", name: "Marunouchi", location: geographyPoint(139.764, 35.681) },
] as const;

export const FILLER_SQL = `
  INSERT INTO geo_points (id, name, location)
  SELECT 'filler-' || value, 'Filler ' || value,
         ST_SetSRID(ST_MakePoint(125 + value % 500 / 100, 25 + value % 300 / 100), 4326)::geography
  FROM generate_series(1, 20000) AS value
`;
