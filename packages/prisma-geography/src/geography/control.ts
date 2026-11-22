import type { ControlExtensionDescriptor } from "@prisma/orm-postgres/components/control";
import { GEOGRAPHY_CODEC_ID } from "./constants.ts";
import { geographyPackMeta } from "./pack-meta.ts";

/** A geography column carries no identity value for the planner to derive. */
export const geographyControlPlaneHooks = {
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
