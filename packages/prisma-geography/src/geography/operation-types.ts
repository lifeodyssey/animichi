import type { CodecExpression, Expression } from "@prisma/orm-postgres/relational-core/expression";
import type { SqlQueryOperationTypes } from "@prisma/orm-postgres/family-contract/types";

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;
type GeographyCodecId = "pg/geography@1";

interface GeographyOperationSelf {
  readonly self: { readonly codecId: GeographyCodecId };
}
type GeographyExpression<CodecTypes extends CodecTypesBase> = CodecExpression<GeographyCodecId, boolean, CodecTypes>;

export interface OperationTypes {
  readonly "pg/geography@1": {
    readonly dwithinMeters: GeographyOperationSelf;
    readonly distanceMeters: GeographyOperationSelf;
    readonly knnOrder: GeographyOperationSelf;
  };
}

export type QueryOperationTypes<CodecTypes extends CodecTypesBase> = SqlQueryOperationTypes<
  CodecTypes,
  {
    readonly dwithinMeters: GeographyOperationSelf & {
      readonly impl: (
        self: GeographyExpression<CodecTypes>,
        other: GeographyExpression<CodecTypes>,
        meters: CodecExpression<"pg/float8@1", boolean, CodecTypes>,
      ) => Expression<{ codecId: "pg/bool@1"; nullable: false }>;
    };
    readonly distanceMeters: GeographyOperationSelf & {
      readonly impl: (
        self: GeographyExpression<CodecTypes>,
        other: GeographyExpression<CodecTypes>,
      ) => Expression<{ codecId: "pg/float8@1"; nullable: false }>;
    };
    readonly knnOrder: GeographyOperationSelf & {
      readonly impl: (
        self: GeographyExpression<CodecTypes>,
        other: GeographyExpression<CodecTypes>,
      ) => Expression<{ codecId: "pg/float8@1"; nullable: false }>;
    };
  }
>;
