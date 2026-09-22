import { describe, inject } from "vitest";
import { acquireUsersRuntime, usersPrisma, type UsersPrisma } from "../src/db/prisma";

/** The suite-owned Postgres context, always provided by the Docker arm setup. */
export interface UsersIntegrationDatabase {
  enabled: boolean;
  /** This arm's own clone of the container's migrated template (#1769). */
  dsn: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    integrationDatabase: UsersIntegrationDatabase;
  }
}

const context = inject("integrationDatabase");

const UNAVAILABLE =
  "integration database is unavailable — the Docker Postgres arm must run (docker + the animichi-test-postgres image)";

function requireEnabled(): UsersIntegrationDatabase {
  if (!context.enabled) throw new Error(UNAVAILABLE);
  return context;
}

/** The suite DSN — this arm's own database, never a live Neon. */
export function databaseUrl(): string {
  return requireEnabled().dsn;
}

/** Gate tests on a live suite database. Fails loudly when the DB is down —
 * the old silent-skip mode is removed. */
export function databaseDescribe(name: string, factory: () => void): void {
  requireEnabled();
  describe(name, factory);
}

/** One request's Prisma access over the REAL serverless runtime: the same
 * `acquireUsersRuntime` + `usersPrisma` pair the `/v1/users/*` boundary builds,
 * disposed the same way on scope exit. */
export interface UsersSeam {
  readonly prisma: UsersPrisma;
  dispose(): PromiseLike<void>;
}

export async function openUsersPrisma(): Promise<UsersSeam> {
  const runtime = await acquireUsersRuntime(databaseUrl());
  return { prisma: usersPrisma(runtime), dispose: () => runtime[Symbol.asyncDispose]() };
}

/**
 * Empty the saved-route closure. The suite's database is its own clone, so this
 * is isolation inside one arm rather than a shared-state mutation — and it goes
 * through the builder, so the suite needs no SQL escape hatch of its own.
 */
export async function emptySavedRoutes(prisma: UsersPrisma): Promise<void> {
  await prisma.executor.query(prisma.builder.public.saved_route_idempotency.delete().build());
  await prisma.executor.query(prisma.builder.public.saved_routes.delete().build());
}
