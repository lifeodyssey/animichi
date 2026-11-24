/**
 * The two slices of Prisma control the migrator calls, each imported on the first call that
 * needs it instead of at startup.
 *
 * Cloudflare refuses a Worker whose startup, the evaluation of its global scope, takes longer than
 * a second. Prisma control's modules build Prisma's and ArkType's validation schemas as they
 * evaluate, which was more than half of the migrator's startup while they were imported
 * statically. A static value import of either slice, or of a Prisma module behind one, anywhere in
 * the Worker's graph brings that work back: `test/sealed-bundle.workerd.test.ts` profiles the
 * sealed bundle's startup for it.
 *
 * Concurrent first callers share one load. A load that rejects stays rejected for the isolate's
 * life: every later call gets the first error, and nothing loads again. The bundle's bytes fix how
 * a module evaluates, so a second attempt could not succeed. An ES module whose evaluation threw
 * keeps its error, and so does the lazy wrapper esbuild writes for one, but the wrapper it writes
 * for a CommonJS module runs the module again after a throw: one attempt is this Worker's rule here,
 * whatever the bundler wraps. A deploy starts new isolates.
 */
function onFirstUse<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => (loaded ??= load());
}

export const snapshotStore = onFirstUse(() => import("./prisma-snapshot-store"));
export const controlSurface = onFirstUse(() => import("./prisma-control-surface"));
