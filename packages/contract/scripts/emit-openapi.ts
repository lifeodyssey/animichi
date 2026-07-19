/**
 * Emit an OpenAPI 3.1 JSON spec from the Catalog oRPC contract.
 *
 * Output: packages/contract/openapi.json
 * The Python client is generated / typed from this spec.
 *
 * Run: npm run emit:openapi
 */

import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OpenAPIGenerator } from "@orpc/openapi";
import { JSON_SCHEMA_REGISTRY, ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { checkinContract } from "../src/checkin-contract.js";
import { catalogContract } from "../src/contract.js";
import { HttpsUrl, shareContract } from "../src/share-contract.js";
import { usersContract } from "../src/users-contract.js";

JSON_SCHEMA_REGISTRY.add(HttpsUrl, { pattern: "^[Hh][Tt][Tt][Pp][Ss]://" });

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

type Contract = Parameters<OpenAPIGenerator["generate"]>[0];
type GenerateOptions = Parameters<OpenAPIGenerator["generate"]>[1];

function describeEmission(contract: Contract, spec: Awaited<ReturnType<typeof generator.generate>>): void {
  const methods = Object.keys(contract);
  const schemas = Object.keys(spec.components?.schemas ?? {});
  process.stdout.write(`Methods: ${methods.join(", ")}\n`);
  process.stdout.write(`Schemas: ${schemas.join(", ") || "(inlined)"}\n`);
}

async function emitOpenApi(
  contract: Contract,
  filename: string,
  options: GenerateOptions,
): Promise<void> {
  const spec = await generator.generate(contract, options);
  const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", filename);
  writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${outPath}\n`);
  describeEmission(contract, spec);
}

await emitOpenApi(catalogContract, "openapi.json", {
  info: {
    title: "Animichi Catalog Service",
    version: "0.1.0",
    description:
      "Read methods of the TS Catalog service, consumed by the Python Agent service.",
  },
});

await emitOpenApi({ ...usersContract, ...checkinContract, ...shareContract }, "users-openapi.json", {
  info: {
    title: "Animichi Users Service",
    version: "0.1.0",
    description: "User-domain routes of the TS Users service, consumed by apps/web.",
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
});
