import { GEOGRAPHY_CODEC_ID, GEOGRAPHY_NATIVE_TYPE } from "./constants.ts";

export function geography<const Srid extends number>(options: { readonly srid: Srid }) {
  const { srid } = options;
  if (!Number.isInteger(srid) || srid < 0) {
    throw new TypeError("geography: srid must be a non-negative integer");
  }
  return {
    codecId: GEOGRAPHY_CODEC_ID,
    nativeType: GEOGRAPHY_NATIVE_TYPE,
    typeParams: { srid },
  } as const;
}
