import type { ExtractCodecTypes } from "@prisma/orm-postgres/relational-core/ast";
import type { geographyDescriptorMap } from "./codec.ts";
import type { GeographyPoint } from "./geojson.ts";

export type Geography<Srid extends number = number> = GeographyPoint<Srid>;
export type CodecTypes = ExtractCodecTypes<typeof geographyDescriptorMap>;
