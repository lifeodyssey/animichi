/**
 * The one construction site for a native client.
 *
 * The contract declares a geography column, so Prisma's runtime requires the
 * geography extension pack's descriptor on every client built from it. Passing
 * it here keeps the Worker tier and every test fixture in lockstep.
 *
 * Prisma's runtime loads on the first call, not at startup
 * (`prisma-runtime-surface.ts`). Cloudflare refuses a Worker whose startup, the
 * evaluation of its global scope, takes longer than a second, and Prisma's
 * modules build their ArkType schemas as they evaluate. A static value import of
 * the slice, or of a Prisma module behind it, brings that work back:
 * `bundle-smoke/sealed-prisma-load.test.ts` profiles the sealed release's
 * startup for it.
 *
 * Concurrent first calls share one load. A load that rejects, the contract's
 * validation included, stays rejected for the isolate's life: every later call
 * gets the first error, and nothing loads again. The bundle's bytes fix how a
 * module evaluates, so a second attempt could not succeed, and esbuild's wrapper
 * for a CommonJS module, `pg` among them, would run it again after a throw. A
 * deploy starts new isolates.
 */
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";

type NativeClientFactory = (url: string) => PostgresClient<Contract>;

/** Prisma's runtime, with the emitted contract validated once however many clients are built from it. */
async function loadClientFactory(): Promise<NativeClientFactory> {
  const { postgres, contractFromJson, geographyRuntimeDescriptor } = await import("./prisma-runtime-surface.ts");
  const contract = contractFromJson<Contract>(contractJson);
  return (url) => postgres({ contract, extensions: [geographyRuntimeDescriptor], url });
}

let clientFactory: Promise<NativeClientFactory> | undefined;

export async function nativeClient(url: string): Promise<PostgresClient<Contract>> {
  clientFactory ??= loadClientFactory();
  return (await clientFactory)(url);
}
