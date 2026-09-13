import { CodecImpl, type CodecInstanceContext } from "@prisma/orm-postgres/components/codec";
import type { JsonValue } from "@prisma/orm-postgres/contract/types";
import { buildCodecDescriptorRegistry } from "@prisma/orm-postgres/relational-core/codec-descriptor-registry";
import type { ProjectionExpr } from "@prisma/orm-postgres/relational-core/ast";
import { PostgresCodecDescriptor, definePostgresCodecs } from "@prisma/orm-postgres/target/codec-descriptor";
import { z } from "zod";
import { GEOGRAPHY_CODEC_ID, GEOGRAPHY_NATIVE_TYPE } from "./constants.ts";
import { decodePointEwkbHex, encodePointEwkt } from "./ewkb.ts";
import type { GeographyPoint } from "./geojson.ts";

export interface GeographyParams {
  readonly srid: number;
}

const geographyParamsSchema = z.object({ srid: z.number().int().nonnegative() });

export class GeographyCodec<Srid extends number> extends CodecImpl<
  typeof GEOGRAPHY_CODEC_ID,
  readonly ["equality"],
  string,
  GeographyPoint<Srid>
> {
  readonly srid: Srid;

  constructor(descriptor: GeographyDescriptor, srid: Srid) {
    super(descriptor);
    this.srid = srid;
  }

  encode(value: GeographyPoint<Srid>): Promise<string> {
    return Promise.resolve(value).then((point) => {
      assertSrid(point, this.srid);
      return encodePointEwkt(point);
    });
  }

  decode(wire: string): Promise<GeographyPoint<Srid>> {
    return Promise.resolve(wire).then((encoded) => decodePointEwkbHex(encoded, this.srid));
  }

  encodeJson(value: GeographyPoint<Srid>): JsonValue {
    assertSrid(value, this.srid);
    return encodePointEwkt(value);
  }

  decodeJson(json: JsonValue): GeographyPoint<Srid> {
    if (typeof json !== "string") {
      throw new TypeError("geography decode: database JSON value must be hex EWKB");
    }
    return decodePointEwkbHex(json, this.srid);
  }
}

export class GeographyDescriptor extends PostgresCodecDescriptor<GeographyParams> {
  readonly codecId = GEOGRAPHY_CODEC_ID;
  readonly traits = ["equality"] as const;
  readonly targetTypes = [GEOGRAPHY_NATIVE_TYPE] as const;
  readonly paramsSchema = geographyParamsSchema;

  protected nativeType(): string {
    return GEOGRAPHY_NATIVE_TYPE;
  }

  protected jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }

  renderOutputType(params: GeographyParams): string {
    return `Geography<${String(params.srid)}>`;
  }

  renderInputType(params: GeographyParams): string {
    return `Geography<${String(params.srid)}>`;
  }

  factory<const Srid extends number>(params: { readonly srid: Srid }): (context: CodecInstanceContext) => GeographyCodec<Srid> {
    return () => new GeographyCodec(this, params.srid);
  }
}

function assertSrid<const Srid extends number>(value: GeographyPoint, expected: Srid): asserts value is GeographyPoint<Srid> {
  if (value.srid !== expected) {
    throw new TypeError(`geography encode: expected SRID ${String(expected)}, received ${String(value.srid)}`);
  }
}

export const geographyDescriptorMap = { geography: new GeographyDescriptor() } as const;
export const geographyCodecRegistry = buildCodecDescriptorRegistry(
  definePostgresCodecs(Object.values(geographyDescriptorMap)),
);
