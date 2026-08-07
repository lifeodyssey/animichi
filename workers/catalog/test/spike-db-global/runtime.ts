import type { StartedTestContainer } from "testcontainers";
import type { SpikeDatabaseContext } from "../spike-db";
import {
  branchDeleted,
  findEphemeralBranch,
  listBranches,
  record,
  apiRequest,
  type NeonBranch,
  type NeonEnvironment,
} from "./neon-api";

export interface SpikeRuntime {
  branch: NeonBranch;
  container?: StartedTestContainer;
  context: SpikeDatabaseContext;
}

/**
 * Direct-cloud runtime context — no neon_local container (#883): the stale
 * container neither binds 5432 on current runners nor survives the serverless
 * fetch round-trip. The ephemeral branch's own connection URI is the only
 * endpoint the suite needs. Cloud-created branches start empty, so the Atlas
 * migration chain (db/migrations) is applied before the suite runs — this is
 * the schema-as-code path the python-integration lane already uses.
 */
export async function buildDirectContext(
  env: NeonEnvironment, branch: NeonBranch,
): Promise<SpikeDatabaseContext> {
  const directDsn = await connectionUri(env, branch.id);
  await applyMigrations(directDsn);
  return {
    enabled: true,
    localDsn: directDsn,
    localHost: "",
    localPort: 0,
    directDsn,
  };
}

async function applyMigrations(directDsn: string): Promise<void> {
  const migrationsDir = new URL("../../../../db/migrations/", import.meta.url);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  // stdio ignored: the gazetteer seed migration prints tens of thousands of
  // INSERT lines that would otherwise swamp the vitest reporter.
  await run("atlas", [
    "migrate", "apply",
    "--dir", migrationsDir.href,
    "--url", directDsn,
    "--revisions-schema", "public",
    "--allow-dirty",
  ], {
    env: { ...process.env, ATLAS_NO_UPDATE_NOTIFIER: "1" },
    stdio: "ignore",
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Pinned to a version tag, not :latest (#883): an unpinned mutable tag breaks
 * the repo's supply-chain pinning discipline and can drift under CI between
 * runs. v1.5 is the newest published tag (Docker Hub, 2025-09-25) and its
 * digest (sha256:15e20ade47a80ae8285d6dbb6877f7482b305eb1021dd5119d33055dce9407ce)
 * is identical to :latest at the time of pinning, so this changes nothing
 * about the current run — it only makes future runs reproducible.
 */
const IMAGE = "neondatabase/neon_local:v1.5";

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForEphemeral(
  env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch,
): Promise<NeonBranch> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const branch = findEphemeralBranch(before, await listBranches(env), parent);
    if (branch) return branch;
    await pause(2_000);
  }
  throw new Error("ephemeral branch was not observable within 60 seconds");
}

export async function connectionUri(env: NeonEnvironment, branchId: string): Promise<string> {
  const query = new URLSearchParams({ branch_id: branchId, database_name: "neondb", role_name: "neondb_owner", pooled: "false" });
  const payload = await apiRequest(env, `projects/${env.projectId}/connection_uri?${query.toString()}`);
  const uri = record(payload, "connection URI").uri;
  if (typeof uri !== "string" || !uri.startsWith("postgres")) {
    throw new Error("Neon API returned an invalid connection URI");
  }
  return uri;
}

/** testcontainers v12 defaults to an image healthcheck; pin listening-ports for deterministic readiness.
 *  Default startup timeout is 60s — a cold GH runner can exceed it (observed in #883 as "Port 5432/tcp
 *  not bound after 60000ms"), so raise it to 180s. */
export async function startContainer(
  env: NeonEnvironment, parent: NeonBranch,
): Promise<StartedTestContainer> {
  const { GenericContainer, Wait } = await import("testcontainers");
  return new GenericContainer(IMAGE)
    .withEnvironment(containerEnv(env, parent))
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forListeningPorts().withStartupTimeout(180_000))
    .start();
}

function containerEnv(env: NeonEnvironment, parent: NeonBranch): Record<string, string> {
  return {
    NEON_API_KEY: env.apiKey,
    NEON_PROJECT_ID: env.projectId,
    PARENT_BRANCH_ID: parent.id,
    DELETE_BRANCH: "true",
  };
}

export async function buildContext(
  env: NeonEnvironment, container: StartedTestContainer, branch: NeonBranch,
): Promise<SpikeDatabaseContext> {
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return { enabled: true, localDsn: localDsnFor(host, port), localHost: host, localPort: port, directDsn: await connectionUri(env, branch.id) };
}

function localDsnFor(host: string, port: number): string {
  return `postgres://neon:npg@${host}:${String(port)}/neondb?sslmode=require`;
}

export async function waitUntilDeleted(env: NeonEnvironment, branchId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await branchDeleted(env, branchId)) return true;
    await pause(2_000);
  }
  return false;
}

export async function stopContainer(container: StartedTestContainer): Promise<unknown> {
  try {
    await container.stop();
    return undefined;
  } catch (error) {
    return error;
  }
}
