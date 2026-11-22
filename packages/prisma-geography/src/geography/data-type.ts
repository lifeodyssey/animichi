import { readJsonMatching, refuseJsonValue, type DataTypeReader, type DataTypeSpelling } from "@prisma/orm-postgres/components/codec";
import { sqlDataType } from "@prisma/orm-postgres/family-contract/data-type";
import { GEOGRAPHY_DATA_TYPE_ID, GEOGRAPHY_SRID } from "./constants.ts";
import { decodePointEwkbHex, encodePointEwkbHex } from "./ewkb.ts";
import type { GeographyPoint } from "./geojson.ts";

const HEX_EWKB_POINT = /^[0-9A-Fa-f]{50}$/u;
const STORED_FORM = `a hex EWKB point in SRID ${String(GEOGRAPHY_SRID)}`;

/** The point a hex EWKB text holds, or `undefined` when it is not a point in the written SRID: the
 * reader then refuses the value, as the PostGIS geometry type does with EWKB it cannot read. */
function pointOf(hex: string): GeographyPoint<typeof GEOGRAPHY_SRID> | undefined {
  try {
    return decodePointEwkbHex(hex, GEOGRAPHY_SRID);
  } catch {
    return undefined;
  }
}

/** Accepts a hex EWKB point in the written SRID, in either case and byte order, and refuses anything else. */
const readGeography: DataTypeReader = (json) => {
  const hex = readJsonMatching(GEOGRAPHY_DATA_TYPE_ID, json, HEX_EWKB_POINT, STORED_FORM);
  return pointOf(hex) === undefined ? refuseJsonValue(GEOGRAPHY_DATA_TYPE_ID, STORED_FORM, json) : hex;
};

/** Writes an accepted point as the upper-case little-endian hex EWKB PostGIS prints. */
const spellGeography: DataTypeSpelling = (json) => {
  const point = typeof json === "string" ? pointOf(json) : undefined;
  return point === undefined ? json : encodePointEwkbHex(point);
};

/**
 * PostGIS's `geography(Point,4326)`. Prisma 8 fills a type text's `{param}` only from an arktype
 * parameter schema, which this pack does not depend on, so the type declares no parameters and
 * writes the one column type its only author creates; the codec keeps the column's `srid` and
 * refuses any other value of it (`srid.ts`).
 */
export const geoGeography = sqlDataType(GEOGRAPHY_DATA_TYPE_ID, {
  read: readGeography,
  spell: spellGeography,
  texts: [{ text: "geography(point,4326)", written: true, catalog: true, display: "geography(Point,4326)" }],
});

export const geographyDataTypes = [geoGeography] as const;
