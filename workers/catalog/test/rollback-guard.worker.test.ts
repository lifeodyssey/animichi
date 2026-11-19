import { describe, expect, it } from "vitest";
import type { Env } from "../src/index";
import { catalogRequest } from "./catalog-request";
import { makeSnapshotBucket, publishTwoSnapshots } from "./fakes/snapshot-bucket";

/**
 * The token guard in front of `POST /catalog/snapshot/rollback`
 * (`src/adapters/inbound/snapshot.ts`), driven through the real app.
 *
 * While no `SNAPSHOT_ADMIN_TOKEN` is configured, the route answers 503
 * `{"error":"snapshot rollback not configured"}` whatever the request carries.
 * Once one is, a request that does not carry it as its bearer token answers 401
 * `{"error":"unauthorized"}`. A refused request leaves the current snapshot where
 * it was; the right token rolls back to the previous one.
 */

const TOKEN = "ops-token";

/** The refused requests: each one's headers, named by what is wrong with them. */
const REFUSED: readonly { case: string; headers: Record<string, string> }[] = [
  { case: "no Authorization header", headers: {} },
  { case: "a non-Bearer scheme", headers: { authorization: `Basic ${btoa(`ops:${TOKEN}`)}` } },
  { case: "a wrong token of the same length", headers: { authorization: "Bearer ops-tokex" } },
  { case: "a wrong token of another length", headers: { authorization: "Bearer ops" } },
];

/** The env of a deployment holding two published snapshots (`snap-daily-2` current) and `token`. */
async function publishedEnv(token: Env["SNAPSHOT_ADMIN_TOKEN"]): Promise<Env> {
  const bucket = makeSnapshotBucket();
  await publishTwoSnapshots(bucket);
  return { ENVIRONMENT: "test", SNAPSHOT_BUCKET: bucket, SNAPSHOT_ADMIN_TOKEN: token };
}

function rollback(env: Env, headers: Record<string, string>): Promise<Response> {
  return catalogRequest("/catalog/snapshot/rollback", { method: "POST", headers }, env);
}

async function currentSnapshotId(env: Env): Promise<string> {
  const res = await catalogRequest("/catalog/snapshot", {}, env);
  const manifest = await res.json<{ snapshotId: string }>();
  return manifest.snapshotId;
}

describe("the rollback guard with a token configured", () => {
  it.each(REFUSED)("answers 401 unauthorized to $case and keeps the current snapshot", async ({ headers }) => {
    const env = await publishedEnv(TOKEN);
    const res = await rollback(env, headers);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(await currentSnapshotId(env)).toBe("snap-daily-2");
  });

  it("rolls back to the previous snapshot for the right token", async () => {
    const env = await publishedEnv(TOKEN);
    const res = await rollback(env, { authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ snapshotId: "snap-daily-1", sourceRunId: "daily-1" });
    expect(await currentSnapshotId(env)).toBe("snap-daily-1");
  });

  it("rolls back for the right token read from a Secrets Store binding", async () => {
    const env = await publishedEnv({ get: () => Promise.resolve(TOKEN) });
    const res = await rollback(env, { authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
    expect(await currentSnapshotId(env)).toBe("snap-daily-1");
  });
});

/** Each refusal's RFC 6750 challenge. */
const CHALLENGED: readonly { case: string; headers: Record<string, string>; challenge: string }[] = [
  { case: "no Authorization header", headers: {}, challenge: 'Bearer realm=""' },
  { case: "a non-Bearer scheme", headers: { authorization: `Basic ${btoa(`ops:${TOKEN}`)}` }, challenge: 'Bearer error="invalid_request"' },
  { case: "a wrong token", headers: { authorization: "Bearer ops-tokex" }, challenge: 'Bearer error="invalid_token"' },
];

describe("the rollback guard's RFC 6750 and RFC 7235 behaviour", () => {
  it.each(CHALLENGED)("sends the challenge $challenge with the 401 for $case", async ({ headers, challenge }) => {
    const res = await rollback(await publishedEnv(TOKEN), headers);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(challenge);
  });

  it.each([`bearer ${TOKEN}`, `BEARER ${TOKEN}`, `Bearer  ${TOKEN}`])(
    "rolls back for the right token under the scheme spelling %j, matched case-insensitively and after one or more spaces",
    async (authorization) => {
      const env = await publishedEnv(TOKEN);
      const res = await rollback(env, { authorization });
      expect(res.status).toBe(200);
      expect(await currentSnapshotId(env)).toBe("snap-daily-1");
    },
  );
});

describe("the rollback guard with no token configured", () => {
  it.each([
    { case: "no token", token: undefined },
    { case: "an empty token", token: "" },
  ])("answers 503 snapshot rollback not configured for $case, even to a bearer token, and keeps the current snapshot", async ({ token }) => {
    const env = await publishedEnv(token);
    const res = await rollback(env, { authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "snapshot rollback not configured" });
    expect(await currentSnapshotId(env)).toBe("snap-daily-2");
  });
});
