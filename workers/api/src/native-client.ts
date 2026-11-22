/**
 * The one construction site for a native client.
 *
 * The contract declares a geography column, so Prisma's runtime requires the
 * geography extension pack's descriptor on every client built from it. Passing
 * it here keeps the Worker tier and every test fixture in lockstep.
 */
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import postgres from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { geographyRuntimeDescriptor } from "@animichi/prisma-geography/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";

/** The emitted contract as a typed value, validated once however many clients are built from it. */
const contract = contractFromJson<Contract>(contractJson);

export function nativeClient(url: string): PostgresClient<Contract> {
  return postgres({ contract, extensions: [geographyRuntimeDescriptor], url });
}
