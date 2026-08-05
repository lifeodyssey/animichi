import type { TestProject } from "vitest/node";
export { findEphemeralBranch, verifyTestBase, type NeonBranch } from "./spike-db-global/neon-api";
import type { StartedTestContainer } from "testcontainers";
import {
  deleteBranch,
  environment,
  findEphemeralBranch,
  listBranches,
  resolveTestBase,
  type NeonBranch,
  type NeonEnvironment,
} from "./spike-db-global/neon-api";
import {
  buildContext,
  startContainer,
  stopContainer,
  waitForEphemeral,
  waitUntilDeleted,
  type SpikeRuntime,
} from "./spike-db-global/runtime";

const SKIP_MESSAGE = "spike suite needs Neon Local — set NEON_API_KEY/NEON_PROJECT_ID";

async function deleteObservedBranch(
  env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch, known?: NeonBranch,
): Promise<unknown> {
  try {
    await deleteIfPresent(env, known ?? findEphemeralBranch(before, await listBranches(env), parent));
    return undefined;
  } catch (error) {
    return error;
  }
}

async function deleteIfPresent(env: NeonEnvironment, branch: NeonBranch | undefined): Promise<void> {
  if (branch) await deleteBranch(env, branch.id);
}

async function cleanupIncomplete(
  env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch,
  container: StartedTestContainer, branch?: NeonBranch,
): Promise<unknown> {
  const stopError = await stopContainer(container);
  const deleteError = await deleteObservedBranch(env, before, parent, branch);
  if (stopError && deleteError) return new AggregateError([stopError, deleteError]);
  return stopError ?? deleteError;
}

async function createRuntime(
  env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch,
): Promise<SpikeRuntime> {
  const container = await startContainer(env, parent);
  return attemptSetup(container, env, before, parent, { branch: undefined });
}

interface BranchBox { branch: NeonBranch | undefined }

/** Provision the ephemeral branch + context; on failure, clean up and rethrow. */
async function attemptSetup(
  container: StartedTestContainer, env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch, box: BranchBox,
): Promise<SpikeRuntime> {
  try {
    box.branch = await waitForEphemeral(env, before, parent);
    return { branch: box.branch, container, context: await buildContext(env, container, box.branch) };
  } catch (error) {
    return handleSetupFailure(env, before, parent, container, box.branch, error);
  }
}

async function handleSetupFailure(
  env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch,
  container: StartedTestContainer, branch: NeonBranch | undefined, error: unknown,
): Promise<never> {
  const cleanupError = await cleanupIncomplete(env, before, parent, container, branch);
  if (!cleanupError) throw error;
  const combined = new AggregateError([error, cleanupError], "spike setup cleanup failed");
  combined.cause = error;
  throw combined;
}

async function stopRuntime(env: NeonEnvironment, runtime: SpikeRuntime): Promise<void> {
  const stopError = await stopContainer(runtime.container);
  if (!await waitUntilDeleted(env, runtime.branch.id)) await deleteBranch(env, runtime.branch.id);
  if (stopError) rethrow(stopError);
}

function rethrow(error: unknown): void {
  if (error instanceof Error) throw error;
  throw new Error("neon_local container stop failed", { cause: error });
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
