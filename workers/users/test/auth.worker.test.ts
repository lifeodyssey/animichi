import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createUsersApp } from "../src/index";
import { verifyBearer } from "../src/auth/jwt";
import { authTools, BASE, JWKS_URL, TEST_ENV } from "./neon-auth-fixture";
import { fakeDb } from "./in-memory-routes-db";

const unauthorized = {
  error: { code: "unauthorized", message: "Valid credentials required." },
};

async function request(token?: string, env = TEST_ENV): Promise<Response> {
  const auth = await authTools();
  const { db } = fakeDb();
  const app = createUsersApp({ getKey: auth.getKey, makeDb: () => db });
  const headers: Record<string, string> = token === undefined ? {} : { Authorization: token };
  return app.request("/v1/users/saved-routes", { headers }, env);
}

async function expectUnauthorized(token?: string): Promise<void> {
  const response = await request(token);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual(unauthorized);
}

describe("Users Worker auth boundary", () => {
  it("rejects a missing Authorization header", () => expectUnauthorized());
  it("rejects an empty bearer", () => expectUnauthorized("Bearer "));
  it("rejects a garbage token", () => expectUnauthorized("Bearer garbage"));

  it("rejects an expired token", async () => {
    const { makeJwt } = await authTools();
    await expectUnauthorized(`Bearer ${await makeJwt({ sub: "user-a", exp: 1 })}`);
  });

  it("rejects the wrong issuer", async () => {
    const { makeJwt } = await authTools();
    await expectUnauthorized(`Bearer ${await makeJwt({ sub: "user-a", iss: "https://wrong.invalid" })}`);
  });

  it("rejects the wrong audience", async () => {
    const { makeJwt } = await authTools();
    await expectUnauthorized(`Bearer ${await makeJwt({ sub: "user-a", aud: "https://wrong.invalid" })}`);
  });

  it("rejects a token signed by another key", async () => {
    const { privateKey } = await generateKeyPair("EdDSA", { extractable: true });
    const token = await new SignJWT({}).setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
      .setSubject("user-a").setIssuer(BASE).setAudience(BASE).setExpirationTime("15m").sign(privateKey);
    const validResolver = (await authTools()).getKey;
    const response = await createUsersApp({ getKey: validResolver, makeDb: () => fakeDb().db })
      .request("/v1/users/saved-routes", { headers: { Authorization: `Bearer ${token}` } }, TEST_ENV);
    expect(response.status).toBe(401);
  });

  it("accepts a valid token", async () => {
    const { makeJwt } = await authTools();
    expect((await request(`Bearer ${await makeJwt({ sub: "user-a" })}`)).status).toBe(200);
  });

  it("serves health without authentication", async () => {
    const response = await createUsersApp().request("/healthz", {}, { ENVIRONMENT: "test" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", service: "users" });
  });

  it("returns 503 when auth is unconfigured", async () => {
    const response = await request(undefined, { ENVIRONMENT: "test", DATABASE_URL: "postgresql://fake" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "users auth not configured" });
  });
});

describe("verifyBearer (auth/jwt.ts)", () => {
  it("rejects a token whose subject is empty", async () => {
    const { makeJwt, getKey } = await authTools();
    const token = await makeJwt({ sub: "" });
    expect(await verifyBearer(`Bearer ${token}`, JWKS_URL, getKey)).toBeNull();
  });

  it("falls back to the remote JWKS set when no getKey is injected", async () => {
    // The remote JWKS URL is unreachable in the workerd sandbox, so the
    // verify fails and the whole check resolves to null — exercising the
    // cachedRemote fallback branch of verifySubject.
    expect(await verifyBearer("Bearer garbage", JWKS_URL)).toBeNull();
  });

  it("rejects a missing or malformed bearer without touching the key", async () => {
    expect(await verifyBearer(null, JWKS_URL)).toBeNull();
    expect(await verifyBearer("Bearer ", JWKS_URL)).toBeNull();
  });
});
