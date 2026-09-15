import type { SqlRuntimeExtensionDescriptor } from "@prisma/orm-postgres/family-runtime";
import { geographyCodecRegistry } from "./codec.ts";
import { packQueryOperations } from "./operations.ts";
import { geographyPackMeta } from "./pack-meta.ts";

const codecDescriptors = Array.from(geographyCodecRegistry.values());

export const geographyRuntimeDescriptor: SqlRuntimeExtensionDescriptor<"postgres"> = {
  kind: "extension",
  id: geographyPackMeta.id,
  version: geographyPackMeta.version,
  familyId: "sql",
  targetId: "postgres",
  types: { codecTypes: { codecDescriptors } },
  codecs: () => codecDescriptors,
  queryOperations: packQueryOperations,
  create: () => ({ familyId: "sql", targetId: "postgres" }),
};

export default geographyRuntimeDescriptor;
