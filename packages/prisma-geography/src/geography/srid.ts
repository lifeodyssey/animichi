import { GEOGRAPHY_SRID } from "./constants.ts";

const WRITTEN_SRID = String(GEOGRAPHY_SRID);

/** Why the pack refuses another SRID: its data type writes one column type, and no other. */
export const ONLY_WRITTEN_SRID =
  `geography: only SRID ${WRITTEN_SRID} is supported, because the geo/geography data type writes geography(Point,${WRITTEN_SRID})`;

/** Refuses an SRID that is not a non-negative integer, then any SRID the data type does not write. */
export function assertWrittenSrid(srid: number): asserts srid is typeof GEOGRAPHY_SRID {
  if (!Number.isInteger(srid) || srid < 0) throw new TypeError("geography: srid must be a non-negative integer");
  if (srid !== GEOGRAPHY_SRID) throw new TypeError(ONLY_WRITTEN_SRID);
}
