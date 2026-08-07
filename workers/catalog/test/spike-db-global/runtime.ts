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
  container: StartedTestContainer;
  context: SpikeDatabaseContext;
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
