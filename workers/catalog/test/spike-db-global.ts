import type { TestProject } from "vitest/node";
import type { StartedTestContainer } from "testcontainers";
import { env as processEnv } from "node:process";
import type { SpikeDatabaseContext } from "./spike-db";

const API_BASE = "https://console.neon.tech/api/v2";
const IMAGE = "neondatabase/neon_local:latest";
const TEST_BASE_NAME = "test-base";
const SKIP_MESSAGE =
  "spike suite needs Neon Local — set NEON_API_KEY/NEON_PROJECT_ID";

interface NeonEnvironment {
  apiKey: string;
  projectId: string;
}

export interface NeonBranch {
  id: string;
  name: string;
  projectId: string;
  parentId: string | null;
  default: boolean;
}

interface SpikeRuntime {
  branch: NeonBranch;
  container: StartedTestContainer;
  context: SpikeDatabaseContext;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Neon API ${label} had an unexpected shape`);
  }
  return value as Record<string, unknown>;
}

function textField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`Neon API branch omitted ${key}`);
  }
  return field;
}

export function parseBranch(value: unknown): NeonBranch {
  const branch = record(value, "branch");
  const parentId = branch.parent_id;
  if (parentId !== null && parentId !== undefined && typeof parentId !== "string") {
    throw new Error("Neon API branch had an invalid parent_id");
  }
  return {
    id: textField(branch, "id"),
    name: textField(branch, "name"),
    projectId: textField(branch, "project_id"),
    parentId: parentId ?? null,
    default: branch.default === true,
  };
}

function parseBranches(value: unknown): NeonBranch[] {
  const branches = record(value, "branch list").branches;
  if (!Array.isArray(branches)) throw new Error("Neon API branch list omitted branches");
  return branches.map(parseBranch);
}

function parseBranchDetail(value: unknown): NeonBranch {
  return parseBranch(record(value, "branch detail").branch);
}

function sameBranch(left: NeonBranch, right: NeonBranch): boolean {
  return left.id === right.id && left.name === right.name
    && left.projectId === right.projectId && left.parentId === right.parentId
    && left.default === right.default;
}

export function verifyTestBase(
  branches: NeonBranch[], detail: NeonBranch, projectId: string,
): NeonBranch {
  const matches = branches.filter((branch) => branch.name === TEST_BASE_NAME);
  if (matches.length !== 1) throw new Error("expected exactly one branch named test-base");
  if (!sameBranch(matches[0] as NeonBranch, detail) || detail.projectId !== projectId) {
    throw new Error("test-base name-on-id verification failed");
  }
  return detail;
}

export function findEphemeralBranch(
  before: NeonBranch[], after: NeonBranch[], parent: NeonBranch,
): NeonBranch | undefined {
  const previousIds = new Set(before.map((branch) => branch.id));
  const matches = after.filter((branch) =>
    !previousIds.has(branch.id) && branch.parentId === parent.id);
  if (matches.length > 1) throw new Error("multiple new branches were parented to test-base");
  const branch = matches[0];
  if (branch && branch.projectId !== parent.projectId) {
    throw new Error("ephemeral branch belongs to another Neon project");
  }
  return branch;
}

function environment(): NeonEnvironment | undefined {
  const apiKey = processEnv.NEON_API_KEY;
  const projectId = processEnv.NEON_PROJECT_ID;
  return apiKey && projectId ? { apiKey, projectId } : undefined;
}

function headers(env: NeonEnvironment): HeadersInit {
  return { Authorization: `Bearer ${env.apiKey}`, Accept: "application/json" };
}

async function apiRequest(
  env: NeonEnvironment, path: string, method = "GET",
): Promise<unknown | undefined> {
  const response = await fetch(`${API_BASE}/${path}`, { method, headers: headers(env) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Neon API returned HTTP ${String(response.status)}`);
  if (response.status === 204) return undefined;
  return response.json() as Promise<unknown>;
}

async function listBranches(env: NeonEnvironment): Promise<NeonBranch[]> {
  const payload = await apiRequest(env, `projects/${env.projectId}/branches?limit=100`);
  return parseBranches(payload);
}

async function getBranch(env: NeonEnvironment, branchId: string): Promise<NeonBranch> {
  const payload = await apiRequest(env, `projects/${env.projectId}/branches/${branchId}`);
  if (payload === undefined) throw new Error(`Neon branch ${branchId} was not found`);
  return parseBranchDetail(payload);
}

async function resolveTestBase(
  env: NeonEnvironment, branches: NeonBranch[],
): Promise<NeonBranch> {
  const matches = branches.filter((branch) => branch.name === TEST_BASE_NAME);
  if (matches.length !== 1) throw new Error("expected exactly one branch named test-base");
  const detail = await getBranch(env, (matches[0] as NeonBranch).id);
  return verifyTestBase(branches, detail, env.projectId);
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForEphemeral(
  env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch,
): Promise<NeonBranch> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const branch = findEphemeralBranch(before, await listBranches(env), parent);
    if (branch) return branch;
    await pause(2_000);
  }
  throw new Error("ephemeral branch was not observable within 60 seconds");
}

async function connectionUri(env: NeonEnvironment, branchId: string): Promise<string> {
  const query = new URLSearchParams({
    branch_id: branchId, database_name: "neondb", role_name: "neondb_owner", pooled: "false",
  });
  const payload = await apiRequest(env, `projects/${env.projectId}/connection_uri?${query}`);
  const uri = record(payload, "connection URI").uri;
  if (typeof uri !== "string" || !uri.startsWith("postgres")) {
    throw new Error("Neon API returned an invalid connection URI");
  }
  return uri;
}

async function startContainer(
  env: NeonEnvironment, parent: NeonBranch,
): Promise<StartedTestContainer> {
  const { GenericContainer } = await import("testcontainers");
  return new GenericContainer(IMAGE)
    .withEnvironment({
      NEON_API_KEY: env.apiKey,
      NEON_PROJECT_ID: env.projectId,
      PARENT_BRANCH_ID: parent.id,
      DELETE_BRANCH: "true",
    })
    .withExposedPorts(5432)
    .start();
}

async function buildContext(
  env: NeonEnvironment, container: StartedTestContainer, branch: NeonBranch,
): Promise<SpikeDatabaseContext> {
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return {
    enabled: true,
    localDsn: `postgres://neon:npg@${host}:${String(port)}/neondb?sslmode=require`,
    localHost: host,
    localPort: port,
    directDsn: await connectionUri(env, branch.id),
  };
}

async function branchDeleted(env: NeonEnvironment, branchId: string): Promise<boolean> {
  const path = `projects/${env.projectId}/branches/${branchId}`;
  return await apiRequest(env, path) === undefined;
}

async function waitUntilDeleted(env: NeonEnvironment, branchId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await branchDeleted(env, branchId)) return true;
    await pause(2_000);
  }
  return false;
}

async function deleteBranch(env: NeonEnvironment, branchId: string): Promise<void> {
  const path = `projects/${env.projectId}/branches/${branchId}`;
  await apiRequest(env, path, "DELETE");
}

async function stopRuntime(env: NeonEnvironment, runtime: SpikeRuntime): Promise<void> {
  let stopError: unknown;
  try {
    await runtime.container.stop();
  } catch (error) {
    stopError = error;
  }
  if (!await waitUntilDeleted(env, runtime.branch.id)) await deleteBranch(env, runtime.branch.id);
  if (stopError) throw stopError;
}

async function createRuntime(
  env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch,
): Promise<SpikeRuntime> {
  const container = await startContainer(env, parent);
  let branch: NeonBranch | undefined;
  try {
    branch = await waitForEphemeral(env, before, parent);
    const context = await buildContext(env, container, branch);
    return { branch, container, context };
  } catch (error) {
    const cleanupError = await cleanupIncomplete(env, before, parent, container, branch);
    if (cleanupError) throw new AggregateError([error, cleanupError], "spike setup cleanup failed");
    throw error;
  }
}

async function cleanupIncomplete(
  env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch,
  container: StartedTestContainer, branch?: NeonBranch,
): Promise<unknown | undefined> {
  const stopError = await stopContainer(container);
  const deleteError = await deleteObservedBranch(env, before, parent, branch);
  if (stopError && deleteError) return new AggregateError([stopError, deleteError]);
  return stopError ?? deleteError;
}

async function stopContainer(container: StartedTestContainer): Promise<unknown | undefined> {
  try {
    await container.stop();
    return undefined;
  } catch (error) {
    return error;
  }
}

async function deleteObservedBranch(
  env: NeonEnvironment, before: NeonBranch[], parent: NeonBranch, known?: NeonBranch,
): Promise<unknown | undefined> {
  try {
    const branch = known ?? findEphemeralBranch(before, await listBranches(env), parent);
    if (branch) await deleteBranch(env, branch.id);
    return undefined;
  } catch (error) {
    return error;
  }
}

async function enabledSetup(project: TestProject, env: NeonEnvironment): Promise<() => Promise<void>> {
  const before = await listBranches(env);
  const parent = await resolveTestBase(env, before);
  const runtime = await createRuntime(env, before, parent);
  try {
    project.provide("spikeDatabase", runtime.context);
  } catch (error) {
    await stopRuntime(env, runtime);
    throw error;
  }
  return async () => stopRuntime(env, runtime);
}

export default async function setup(project: TestProject): Promise<void | (() => Promise<void>)> {
  const env = environment();
  if (env) return enabledSetup(project, env);
  project.provide("spikeDatabase", { enabled: false, skipMessage: SKIP_MESSAGE });
}
