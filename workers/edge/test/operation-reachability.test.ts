import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { createWorkerApp } from "../src/app.ts";
import { alwaysAllowGuard, envWithContainer, stubCtx } from "../src/container/entry-env.ts";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";

// Issue #1005 AC1: every operation advertised by a generated OpenAPI document
// must be reachable through the edge's service binding route. The edge is the
// gateway — an advertised operation the edge 404s is a phantom surface. This
// test drives the real gateway (createWorkerApp) for every operation in the
// committed generated documents and asserts the request reaches the intended
// binding (CONTAINER for Agent, USERS for the Users service).

const PACKAGE_DIR = fileURLToPath(new URL("../../../packages/contract", import.meta.url));

function readDocument(filename: string): {
  paths: Record<string, Record<string, unknown>>;
} {
  return JSON.parse(readFileSync(`${PACKAGE_DIR}/${filename}`, "utf8")) as {
    paths: Record<string, Record<string, unknown>>;
  };
}

function operations(document: { paths: Record<string, Record<string, unknown>> }): { method: string; path: string }[] {
  const result: { method: string; path: string }[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of Object.keys(item)) {
      result.push({ method: method.toUpperCase(), path });
    }
  }
  return result;
}

/** Substitute every `{param}` segment with a concrete value. */
function concretePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, "test");
}

const authed = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);

/** Minimal CONTAINER binding: any request gets the same stub response. */
function containerStub() {
  return {
    idFromName: () => "id",
    get: () => ({ fetch: () => Promise.resolve(new Response("container")) }),
  };
}

function usersEnv(users: { fetch(req: Request): Promise<Response> }) {
  return {
    EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: alwaysAllowGuard,
    CONTAINER: containerStub(),
    USERS: users,
  } as never;
}

void test("every Agent OpenAPI operation is reachable through the CONTAINER binding", async () => {
  const agentOps = operations(readDocument("agent-openapi.json"));
  assert.ok(agentOps.length > 0, "agent-openapi.json must advertise operations");
  for (const operation of agentOps) {
    const captured: { req?: Request } = {};
    const app = createWorkerApp({ authenticate: authed });
    const res = await app.request(concretePath(operation.path), { method: operation.method }, envWithContainer(captured), stubCtx);
    assert.equal(res.status !== 404, true, `${operation.method} ${operation.path} must not 404`);
    assert.ok(captured.req, `${operation.method} ${operation.path} must reach the container binding`);
  }
});

void test("every Users OpenAPI operation is reachable through the USERS binding", async () => {
  const usersOps = operations(readDocument("users-openapi.json"));
  assert.ok(usersOps.length > 0, "users-openapi.json must advertise operations");
  for (const operation of usersOps) {
    assert.equal(operation.path.startsWith(USERS_BINDING_PREFIX), true);
    let reached = false;
    const app = createWorkerApp({ authenticate: authed });
    const env = usersEnv({ fetch: () => { reached = true; return Promise.resolve(new Response("users")); } });
    const res = await app.request(concretePath(operation.path), { method: operation.method }, env, stubCtx);
    assert.equal(res.status !== 404, true, `${operation.method} ${operation.path} must not 404`);
    assert.equal(reached, true, `${operation.method} ${operation.path} must reach the USERS binding`);
  }
});
