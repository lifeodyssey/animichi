/**
 * Emit an OpenAPI 3.1 JSON spec from the Catalog oRPC contract.
 *
 * Output: packages/contract/openapi.json
 * The Python client is generated / typed from this spec.
 *
 * Run: npm run emit:openapi
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { checkinContract } from "../src/checkin-contract.js";
import { catalogContract } from "../src/contract.js";
import { usersContract } from "../src/users-contract.js";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

async function emitOpenApi(
  contract: Parameters<OpenAPIGenerator["generate"]>[0],
  filename: string,
  info: { title: string; version: string; description: string },
): Promise<void> {
  const spec = await generator.generate(contract, { info });
  const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", filename);
  writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  const methods = Object.keys(contract);
  const schemaNames = Object.keys(spec.components?.schemas ?? {});
  process.stdout.write(`Wrote ${outPath}\n`);
  process.stdout.write(`Methods: ${methods.join(", ")}\n`);
  process.stdout.write(`Schemas: ${schemaNames.join(", ") || "(inlined)"}\n`);
}

await emitOpenApi(catalogContract, "openapi.json", {
    title: "Animichi Catalog Service",
    version: "0.1.0",
    description:
      "Read methods of the TS Catalog service, consumed by the Python Agent service.",
});

await emitOpenApi({ ...usersContract, ...checkinContract }, "users-openapi.json", {
  title: "Animichi Users Service",
  version: "0.1.0",
  description: "User-domain routes of the TS Users service, consumed by apps/web.",
});
