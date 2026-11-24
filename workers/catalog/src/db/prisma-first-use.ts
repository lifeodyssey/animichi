/**
 * The catalog's Prisma data-plane access (`./prisma`), imported on the first request that needs it
 * instead of at startup.
 *
 * Cloudflare refuses a Worker whose startup, the evaluation of its global scope, takes longer than
 * a second. `./prisma` and the Prisma modules it imports build Prisma's and ArkType's validation
 * schemas as they evaluate, and `./prisma` validates the shared contract: more than half of the
 * catalog's startup while it was imported statically. A static value import of `./prisma` anywhere
 * in the Worker's graph brings that work back, and `test/sealed-bundle.node.test.ts` profiles the
 * sealed bundle's startup for it. A type-only import is erased and costs nothing.
 *
 * Concurrent first callers share one load. A load that rejects stays rejected for the isolate's
 * life: every later call gets the first error, and nothing loads again. The bundle's bytes fix how
 * a module evaluates, so a second attempt could not succeed. An ES module whose evaluation threw
 * keeps its error, and so does the lazy wrapper esbuild writes for one, but the wrapper it writes
 * for a CommonJS module, `pg` among them, runs the module again after a throw: one attempt is this
 * Worker's rule, whatever the bundler wraps. A deploy starts new isolates.
 */
let loaded: Promise<typeof import("./prisma")> | undefined;

export function prismaAccess(): Promise<typeof import("./prisma")> {
  loaded ??= import("./prisma");
  return loaded;
}
