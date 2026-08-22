import type { BuildHandle, BuildsClient, BuildStatus, StartBuildInput } from "./builds";
import type { Env } from "./create-app";

const BUILDS_API = "https://api.cloudflare.com/client/v4";

/**
 * Live Cloudflare Workers Builds client, bound to the request env. Tests never
 * call this adapter (excluded from coverage; verified by the deploy smoke).
 * The account id comes from the env binding, never from the request.
 */
export function liveBuildsClient(env: Env): BuildsClient {
  return {
    start: (input: StartBuildInput) => startBuild(env, input),
    status: (buildId: string) => fetchStatus(env, buildId),
  };
}

async function apiToken(env: Env): Promise<string> {
  const token = env.BUILDS_API_TOKEN;
  if (token === undefined) return "";
  return typeof token === "string" ? token : await token.get();
}

function accountIdOf(env: Env): string {
  return env.CLOUDFLARE_ACCOUNT_ID ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resultOf(envelope: unknown): Record<string, unknown> | null {
  return isRecord(envelope) && isRecord(envelope.result) ? envelope.result : null;
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function buildIdOf(envelope: unknown): string {
  const result = resultOf(envelope);
  const id = result === null ? undefined : stringField(result, ["id", "build_uuid"]);
  if (id === undefined) throw new Error("builds api unavailable");
  return id;
}

function statusOf(envelope: unknown, buildId: string): BuildStatus {
  const result = resultOf(envelope);
  const status = result === null ? "unknown" : (stringField(result, ["status"]) ?? "unknown");
  const outcome = result === null ? undefined : stringField(result, ["outcome", "build_outcome"]);
  return outcome === undefined ? { id: buildId, status } : { id: buildId, status, outcome };
}

function buildsUrl(env: Env, triggerId: string): string {
  return `${BUILDS_API}/accounts/${accountIdOf(env)}/builds/triggers/${triggerId}/builds`;
}

function statusUrl(env: Env, buildId: string): string {
  return `${BUILDS_API}/accounts/${accountIdOf(env)}/builds/builds/${buildId}`;
}

async function postHeaders(env: Env): Promise<Record<string, string>> {
  return { "content-type": "application/json", authorization: `Bearer ${await apiToken(env)}` };
}

async function readEnvelope(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error("builds api unavailable");
  return response.json();
}

async function startBuild(env: Env, input: StartBuildInput): Promise<BuildHandle> {
  const response = await fetch(buildsUrl(env, input.triggerId), {
    method: "POST",
    headers: await postHeaders(env),
    body: JSON.stringify({ commit_hash: input.commit }),
  });
  return { buildId: buildIdOf(await readEnvelope(response)) };
}

async function fetchStatus(env: Env, buildId: string): Promise<BuildStatus> {
  const response = await fetch(statusUrl(env, buildId), {
    headers: { authorization: `Bearer ${await apiToken(env)}` },
  });
  return statusOf(await readEnvelope(response), buildId);
}
