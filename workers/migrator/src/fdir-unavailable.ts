/**
 * `fdir` as the migrator's Worker bundle carries it: `wrangler.toml` aliases the package here.
 *
 * The real `fdir` is the file crawler behind tinyglobby's `glob()`. Prisma's toolchain reaches it
 * only to expand contract-source globs while it loads a config for `prisma contract emit`, but the
 * control client the migrator runs shares one module chunk with that loader
 * (`@prisma/orm-postgres/control` imports `@prisma/orm-toolchain/cli/control-api`), so the crawler
 * is in the Worker's module graph although no request crawls. Its module top level calls
 * `createRequire(import.meta.url)`, and workerd leaves `import.meta.url` undefined, so with the real
 * module the bundle cannot start at all.
 *
 * tinyglobby's pattern checks (`isDynamicPattern`, which `defineConfig` calls on every preview)
 * need no crawler and stay real. A Worker has no filesystem to crawl, so `new fdir(…)`, tinyglobby's
 * one use of the package, throws and says why, rather than finding nothing.
 */
export function fdir(): never {
  throw new Error("fdir is unavailable in the migrator Worker: it has no filesystem to crawl, and only the Prisma CLI globs");
}
