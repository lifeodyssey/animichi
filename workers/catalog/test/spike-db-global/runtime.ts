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
  context: SpikeDatabaseContext;
}

/**
 * Direct-cloud runtime context — no neon_local container (#883): the stale
 * container neither binds 5432 on current runners nor survives the serverless
 * fetch round-trip. The ephemeral branch's own connection URI is the only
 * endpoint the suite needs. Cloud-created branches start empty, so the Atlas
 * migration chain (migrations/neon) is applied before the suite runs — this is
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
  const migrationsDir = new URL("../../../../migrations/neon/", import.meta.url);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  // Child output is captured into the callback buffer (never printed), so
  // the schema chain's DDL/GRANT output does not swamp the vitest reporter.
  // The gazetteer seed (workers/catalog/data/gazetteer_seed.sql) is applied
  // by the test-base provisioner (scripts/neon-test-base.sh), and ephemeral
  // branches inherit it from the test-base parent, so it is not re-applied
  // here. Existing branches that already recorded the old gazetteer migration
  // keep their data; Atlas tolerates the removed file (verified on 0.30.0).
  await run("atlas", [
    "migrate", "apply",
    "--dir", migrationsDir.href,
    "--url", directDsn,
    "--revisions-schema", "public",
    "--allow-dirty",
  ], {
    env: { ...process.env, ATLAS_NO_UPDATE_NOTIFIER: "1" },
    maxBuffer: 10 * 1024 * 1024,
  });
}

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

export async function waitUntilDeleted(env: NeonEnvironment, branchId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await branchDeleted(env, branchId)) return true;
    await pause(2_000);
  }
  return false;
}
