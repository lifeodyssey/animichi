import { env as processEnv } from "node:process";

const API_BASE = "https://console.neon.tech/api/v2";
const TEST_BASE_NAME = "test-base";

export interface NeonEnvironment {
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

export function record(value: unknown, label: string): Record<string, unknown> {
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
  return {
    id: textField(branch, "id"),
    name: textField(branch, "name"),
    projectId: textField(branch, "project_id"),
    parentId: optionalParentId(branch),
    default: branch.default === true,
  };
}

function optionalParentId(branch: Record<string, unknown>): string | null {
  const parentId = branch.parent_id;
  if (parentId != null && typeof parentId !== "string") throw new Error("Neon API branch had an invalid parent_id");
  return parentId ?? null;
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
  const [only] = matches;
  if (matches.length !== 1 || !only) throw new Error("expected exactly one branch named test-base");
  if (!sameBranch(only, detail) || detail.projectId !== projectId) throw new Error("test-base name-on-id verification failed");
  return detail;
}

export function findEphemeralBranch(
  before: NeonBranch[], after: NeonBranch[], parent: NeonBranch,
): NeonBranch | undefined {
  const matches = after.filter((branch) => !beforeIds(before).has(branch.id) && branch.parentId === parent.id);
  if (matches.length > 1) throw new Error("multiple new branches were parented to test-base");
  const branch = matches[0];
  if (branch && branch.projectId !== parent.projectId) throw new Error("ephemeral branch belongs to another Neon project");
  return branch;
}

function beforeIds(before: NeonBranch[]): Set<string> {
  return new Set(before.map((branch) => branch.id));
}

export function environment(): NeonEnvironment | undefined {
  const apiKey = processEnv.NEON_API_KEY;
  const projectId = processEnv.NEON_PROJECT_ID;
  if (!apiKey || !projectId) return undefined;
  return { apiKey, projectId };
}

function headers(env: NeonEnvironment): HeadersInit {
  return { Authorization: `Bearer ${env.apiKey}`, Accept: "application/json" };
}

export async function apiRequest(
  env: NeonEnvironment, path: string, method = "GET",
): Promise<unknown> {
  const response = await fetch(`${API_BASE}/${path}`, { method, headers: headers(env) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Neon API ${method} ${path} failed: ${String(response.status)}`);
  return await response.json();
}

export async function listBranches(env: NeonEnvironment): Promise<NeonBranch[]> {
  const payload = await apiRequest(env, `projects/${env.projectId}/branches`);
  return parseBranches(payload);
}

export async function getBranch(env: NeonEnvironment, branchId: string): Promise<NeonBranch> {
  const payload = await apiRequest(env, `projects/${env.projectId}/branches/${branchId}`);
  return parseBranchDetail(payload);
}

export async function resolveTestBase(
  env: NeonEnvironment, branches: NeonBranch[],
): Promise<NeonBranch> {
  const named = branches.filter((branch) => branch.name === TEST_BASE_NAME);
  const [only] = named;
  if (named.length !== 1 || !only) throw new Error("expected exactly one branch named test-base");
  return verifyTestBase(branches, await getBranch(env, only.id), env.projectId);
}

export async function deleteBranch(env: NeonEnvironment, branchId: string): Promise<void> {
  const path = `projects/${env.projectId}/branches/${branchId}`;
  await apiRequest(env, path, "DELETE");
}

export async function branchDeleted(env: NeonEnvironment, branchId: string): Promise<boolean> {
  const path = `projects/${env.projectId}/branches/${branchId}`;
  return await apiRequest(env, path) === undefined;
}
