/**
 * Connection-string resolution for the Worker's composition root.
 *
 * What used to live beside it — a pool of long-lived `CatalogDb` clients keyed
 * by connection string — went with the Drizzle seam (#1633). The Prisma plane's
 * shape is the opposite by design: the client is stateless and memoized, and the
 * CONNECTION is per request, acquired at the `/catalog/*` boundary (or by a cron
 * pass) and given back with `await using` on scope exit. See `./prisma`.
 */

/** The environment slice needed to resolve a connection string. */
export interface ConnectionEnv {
  DATABASE_URL?: string | { get(): Promise<string> };
}

/** The Neon URL / Secrets Store secret for this deployment (#912 PR2, #1628). */
export async function connectionString(env?: ConnectionEnv): Promise<string | undefined> {
  const url = env?.DATABASE_URL;
  if (url == null) return undefined;
  return typeof url === "string" ? url : await url.get();
}
