import { geographyRuntimeDescriptor } from "@animichi/prisma-geography/runtime";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import postgresClient from "@prisma/orm-postgres/runtime";
import contractJson from "../src/contract.json" with { type: "json" };
import type { Contract } from "../src/contract.d.ts";

/** The one construction site for a native client: the contract JSON plus the geography
 * runtime descriptor every caller must pass. Tests differ only in the URL they own. */
export function contractClient(url: string): PostgresClient<Contract> {
  return postgresClient<Contract>({ contractJson, extensions: [geographyRuntimeDescriptor], url });
}
