import type { AuthoringTypeNamespace } from "@prisma/orm-postgres/components/authoring";
import { geographyCodecRegistry } from "./codec.ts";
import { GEOGRAPHY_CODEC_ID, GEOGRAPHY_NATIVE_TYPE } from "./constants.ts";

const PACKAGE_NAME = "@animichi/prisma-geography";
const geographyAuthoringTypes = {
  geo: {
    Geography: {
      kind: "typeConstructor",
      args: [{ kind: "number", name: "srid", integer: true, minimum: 0 }],
      output: {
        codecId: GEOGRAPHY_CODEC_ID,
        nativeType: GEOGRAPHY_NATIVE_TYPE,
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
  types: {
    codecTypes: {
      codecDescriptors: Array.from(geographyCodecRegistry.values()),
      import: { package: `${PACKAGE_NAME}/codec-types`, named: "CodecTypes", alias: "GeoTypes" },
      typeImports: [{ package: `${PACKAGE_NAME}/codec-types`, named: "Geography", alias: "Geography" }],
    },
    queryOperationTypes: {
      import: {
        package: `${PACKAGE_NAME}/operation-types`,
        named: "QueryOperationTypes",
        alias: "GeoQueryOperationTypes",
      },
    },
    storage: [{ typeId: GEOGRAPHY_CODEC_ID, familyId: "sql", targetId: "postgres", nativeType: GEOGRAPHY_NATIVE_TYPE }],
  },
} as const;
