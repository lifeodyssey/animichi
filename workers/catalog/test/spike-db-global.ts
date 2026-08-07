import type { TestProject } from "vitest/node";
export { findEphemeralBranch, verifyTestBase, type NeonBranch } from "./spike-db-global/neon-api";
import {
  createBranch,
  createEndpoint,
  deleteBranch,
  endpointReady,
  purgeOrphanBranches,
  environment,
  listBranches,
  resolveTestBase,
  type NeonBranch,
  type NeonEnvironment,
} from "./spike-db-global/neon-api";
import {
  buildDirectContext,
  waitUntilDeleted,
  type SpikeRuntime,
} from "./spike-db-global/runtime";

const SKIP_MESSAGE = "spike suite needs Neon Local — set NEON_API_KEY/NEON_PROJECT_ID";

async function createRuntime(
  env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch,
): Promise<SpikeRuntime> {
  // Direct-cloud mode (#883): no neon_local container — the ephemeral branch
  // is created through the Neon API and the suite connects to its own
  // connection URI, so no local proxy is involved at all. Leftover branches
  // from parallel CI runs starve the 10-branch quota, so purge orphans first.
  await purgeOrphanBranches(env, before);
  const branch = await createBranch(
    env, parent.id, `catalog-spike-${String(Date.now())}-${String(process.pid)}`,
  );
  await createEndpoint(env, branch.id);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await endpointReady(env, branch.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return { branch, context: await buildDirectContext(env, branch) };
}



async function stopRuntime(env: NeonEnvironment, runtime: SpikeRuntime): Promise<void> {
  if (!await waitUntilDeleted(env, runtime.branch.id)) await deleteBranch(env, runtime.branch.id);
}

async function enabledSetup(project: TestProject, env: NeonEnvironment): Promise<() => Promise<void>> {
  const before = await listBranches(env);
  const parent = await resolveTestBase(env, before);
  const runtime = await createRuntime(env, before, parent);
  await provideOrCleanup(project, env, runtime);
  return async () => stopRuntime(env, runtime);
}

async function provideOrCleanup(project: TestProject, env: NeonEnvironment, runtime: SpikeRuntime): Promise<void> {
  try {
    project.provide("spikeDatabase", runtime.context);
  } catch (error) {
    await stopRuntime(env, runtime);
    throw error;
  }
}

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  const env = environment();
  if (env) return enabledSetup(project, env);
  project.provide("spikeDatabase", { enabled: false, skipMessage: SKIP_MESSAGE });
}
