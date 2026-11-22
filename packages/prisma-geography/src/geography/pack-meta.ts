import type { AuthoringTypeNamespace } from "@prisma/orm-postgres/components/authoring";
import { geographyCodecRegistry } from "./codec.ts";
import { GEOGRAPHY_CODEC_ID } from "./constants.ts";
import { geographyDataTypes } from "./data-type.ts";

const PACKAGE_NAME = "@animichi/prisma-geography";
const geographyAuthoringTypes = {
  geo: {
    Geography: {
      kind: "typeConstructor",
      inferred: true,
      args: [{ kind: "value", dataType: "pg/int4", name: "srid" }],
      output: {
        codecId: GEOGRAPHY_CODEC_ID,
        typeParams: { srid: { kind: "arg", index: 0 } },
      },
    },
  },
} as const satisfies Record<string, AuthoringTypeNamespace>;

export const geographyPackMeta = {
  kind: "extension",
  id: "geo",
  familyId: "sql",
  targetId: "postgres",
  version: "0.1.0",
  capabilities: { postgres: { "geo.geography": true } },
  authoring: { type: geographyAuthoringTypes },
  dataTypes: geographyDataTypes,
  types: {
    codecTypes: {
      codecDescriptors: Array.from(geographyCodecRegistry.values()),
      import: { package: `${PACKAGE_NAME}/codec-types`, named: "CodecTypes", alias: "GeoTypes" },
    },
    queryOperationTypes: {
      import: {
        package: `${PACKAGE_NAME}/operation-types`,
        named: "QueryOperationTypes",
        alias: "GeoQueryOperationTypes",
      },
    },
  },
} as const;
