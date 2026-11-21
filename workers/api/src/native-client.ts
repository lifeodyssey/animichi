/**
 * The one construction site for a native client.
 *
 * The contract declares a geography column, so Prisma's runtime requires the
 * geography extension pack's descriptor on every client built from it. Passing
 * it here keeps the Worker tier and every test fixture in lockstep.
 */
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import postgres from "@prisma/orm-postgres/runtime";
import { geographyRuntimeDescriptor } from "@animichi/prisma-geography/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";

export function nativeClient(url: string): PostgresClient<Contract> {
  return postgres<Contract>({ contractJson, extensions: [geographyRuntimeDescriptor], url });
}
