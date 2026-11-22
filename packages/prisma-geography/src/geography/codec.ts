import { CodecImpl, readJsonString, type CodecInstanceContext, type DataTypeValue } from "@prisma/orm-postgres/components/codec";
import { CastExpr, type ProjectionExpr } from "@prisma/orm-postgres/relational-core/ast";
import { buildCodecDescriptorRegistry } from "@prisma/orm-postgres/relational-core/codec-descriptor-registry";
import { PostgresCodecDescriptor, definePostgresCodecs } from "@prisma/orm-postgres/target/codec-descriptor";
import { z } from "zod";
import { GEOGRAPHY_CODEC_ID, GEOGRAPHY_SRID } from "./constants.ts";
import { geoGeography } from "./data-type.ts";
import { decodePointEwkbHex, encodePointEwkbHex, encodePointEwkt } from "./ewkb.ts";
import type { GeographyPoint } from "./geojson.ts";
import { ONLY_WRITTEN_SRID, assertWrittenSrid } from "./srid.ts";

export interface GeographyParams {
  readonly srid: number;
}

/** The application value of a column of the pack's data type, which holds SRID 4326 only. */
type WrittenPoint = GeographyPoint<typeof GEOGRAPHY_SRID>;

const geographyParamsSchema = z.object({
  srid: z.number().int().nonnegative().refine((srid) => srid === GEOGRAPHY_SRID, { message: ONLY_WRITTEN_SRID }),
});
const finiteCoordinate = z.number().refine(Number.isFinite, { message: "coordinates must be finite" });
const geographyPointSchema = z
  .object({
    type: z.literal("Point"),
    coordinates: z.tuple([finiteCoordinate, finiteCoordinate]),
    srid: z.number().int().nonnegative(),
  })
  .strict();

export class GeographyCodec extends CodecImpl<typeof GEOGRAPHY_CODEC_ID, readonly ["equality"], string, WrittenPoint> {
  constructor(descriptor: GeographyDescriptor) {
    super(descriptor, geoGeography);
  }

  toWire(value: WrittenPoint): Promise<string> {
    return Promise.resolve(value).then((point) => encodePointEwkt(validatePoint(point)));
  }

  fromWire(wire: string): Promise<WrittenPoint> {
    return Promise.resolve(wire).then((encoded) => decodePointEwkbHex(encoded, GEOGRAPHY_SRID));
  }

  toDataTypeValue(input: WrittenPoint): DataTypeValue {
    return this.dataTypeValueOf(encodePointEwkbHex(validatePoint(input)));
  }

  /** The data type has already read the stored value as a hex EWKB point in SRID 4326. */
  fromDataTypeValue(value: DataTypeValue): WrittenPoint {
    return decodePointEwkbHex(readJsonString(geoGeography.id, value.value), GEOGRAPHY_SRID);
  }
}

export class GeographyDescriptor extends PostgresCodecDescriptor<GeographyParams> {
  readonly jsonType = "object" as const;
  readonly dataType = geoGeography.id;
  readonly codecId = GEOGRAPHY_CODEC_ID;
  readonly traits = ["equality"] as const;
  readonly paramsSchema = geographyParamsSchema;

  /** The hex EWKB text PostgreSQL prints for a geography, which `fromWire` reads as it reads a row. */
  protected jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, "text");
  }

  factory(params: GeographyParams): (context: CodecInstanceContext) => GeographyCodec {
    assertWrittenSrid(params.srid);
    return () => new GeographyCodec(this);
  }
}

function assertSrid(value: GeographyPoint): asserts value is WrittenPoint {
  if (value.srid !== GEOGRAPHY_SRID) {
    throw new TypeError(`geography encode: expected SRID ${String(GEOGRAPHY_SRID)}, received ${String(value.srid)}`);
  }
}

function validatePoint(value: unknown): WrittenPoint {
  const point = geographyPointSchema.parse(value);
  assertSrid(point);
  return point;
}

export const geographyDescriptorMap = { geography: new GeographyDescriptor() } as const;
export const geographyCodecRegistry = buildCodecDescriptorRegistry(
  definePostgresCodecs(Object.values(geographyDescriptorMap)),
);
