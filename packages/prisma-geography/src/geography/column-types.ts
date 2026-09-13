import { GEOGRAPHY_CODEC_ID, GEOGRAPHY_NATIVE_TYPE } from "./constants.ts";

function assertValidSrid(srid: number): void {
  if (!Number.isInteger(srid) || srid < 0) {
    throw new TypeError("geography: srid must be a non-negative integer");
  }
}

export function geography<const Srid extends number>(options: { readonly srid: Srid }) {
  const { srid } = options;
  assertValidSrid(srid);
  return {
    codecId: GEOGRAPHY_CODEC_ID,
    nativeType: GEOGRAPHY_NATIVE_TYPE,
    typeParams: { srid },
  } as const;
}
