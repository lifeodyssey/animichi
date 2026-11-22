import { GEOGRAPHY_CODEC_ID } from "./constants.ts";
import { assertWrittenSrid } from "./srid.ts";

export function geography<const Srid extends number>(options: { readonly srid: Srid }) {
  const { srid } = options;
  assertWrittenSrid(srid);
  return {
    codecId: GEOGRAPHY_CODEC_ID,
    typeParams: { srid },
  } as const;
}
