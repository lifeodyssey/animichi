import type { ControlExtensionDescriptor } from "@prisma/orm-postgres/components/control";
import { GEOGRAPHY_CODEC_ID } from "./constants.ts";
import { geographyPackMeta } from "./pack-meta.ts";

interface NativeTypeInput {
  readonly nativeType: string;
  readonly typeParams?: Readonly<Record<string, unknown>>;
}

function expandNativeType({ nativeType, typeParams }: NativeTypeInput): string {
  const srid = typeParams?.srid;
  if (typeof srid !== "number" || !Number.isInteger(srid) || srid < 0) return nativeType;
  return `${nativeType}(Point,${String(srid)})`;
}

export const geographyControlPlaneHooks = {
  expandNativeType,
  resolveIdentityValue: () => null,
};

export const geographyExtensionDescriptor: ControlExtensionDescriptor<"sql", "postgres"> = {
  ...geographyPackMeta,
  types: {
    ...geographyPackMeta.types,
    codecTypes: {
      ...geographyPackMeta.types.codecTypes,
      controlPlaneHooks: { [GEOGRAPHY_CODEC_ID]: geographyControlPlaneHooks },
    },
  },
  create: () => ({ familyId: "sql", targetId: "postgres" }),
};

export default geographyExtensionDescriptor;
