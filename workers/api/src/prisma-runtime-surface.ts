/**
 * The Prisma runtime calls behind `nativeClient`, imported only through `native-client.ts`, on the
 * first call that needs a client. A static import of this file evaluates Prisma at startup.
 *
 * It names in one module everything the first load takes from Prisma, and the load is counted at it
 * (`test/native-client-first-load.test.ts`). A dynamic import keeps the whole namespace it names, but
 * these three entries export little else: importing them directly measured 8 KiB more upload.
 *
 * The last re-export serves esbuild, not `nativeClient`. Behind this dynamic import, the geography
 * pack's `import { z } from "zod"` makes esbuild wrap zod's modules in lazy initializers. zod declares
 * its `zod/v4` entry free of side effects, so in a bundle where nothing lazy imports that entry,
 * esbuild drops it together with the initializer call it carried, and a module reaching zod through
 * it (the Agents SDK's MCP schemas) runs before zod's classes exist: workerd refuses the bundle with
 * "ZodLazy is not a constructor". Re-exporting the entry here keeps that call in every bundle that
 * holds this slice; without it, `bundle-smoke/session-startup.test.ts` and two `test:native-host`
 * entries fail to start. Delete it when the geography pack stops importing zod, or when esbuild keeps
 * that call itself.
 */
export { default as postgres } from "@prisma/orm-postgres/runtime";
export { contractFromJson } from "@prisma/orm-postgres/static";
export { geographyRuntimeDescriptor } from "@animichi/prisma-geography/runtime";
export { default as zodV4 } from "zod/v4";
