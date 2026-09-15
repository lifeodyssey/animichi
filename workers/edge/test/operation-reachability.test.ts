import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { alwaysAllowGuard, envWithContainer, stubCtx } from "../src/container/entry-env.ts";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";

// Issue #1005 AC1: every operation advertised by a generated OpenAPI document
// must be reachable through the edge's service binding route. The edge is the
// gateway — an advertised operation the edge 404s is a phantom surface. This
// test drives the real gateway (createWorkerApp) for every operation in the
// committed generated documents and asserts the request reaches the intended
// binding (CONTAINER for Agent, USERS for the Users service), with the
// explicitly named edge-native exceptions partitioned out above.

const PACKAGE_DIR = fileURLToPath(new URL("../../../packages/contract", import.meta.url));
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

interface AdvertisedOperation {
  readonly method: string;
  readonly path: string;
}

function readDocument(filename: string): {
  paths: Record<string, Record<string, unknown>>;
} {
  return JSON.parse(readFileSync(`${PACKAGE_DIR}/${filename}`, "utf8")) as {
    paths: Record<string, Record<string, unknown>>;
  };
}

function operations(document: { paths: Record<string, Record<string, unknown>> }): AdvertisedOperation[] {
  const result: AdvertisedOperation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of Object.keys(item).filter((key) => HTTP_METHODS.has(key))) {
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

/** A USERS binding that records whether a request reached it. */
function usersBinding(reached: { value: boolean }) {
  return {
    fetch: () => {
      reached.value = true;
      return Promise.resolve(new Response("users"));
    },
  };
}

/** The operations the edge answers itself — advertised Agent operations that
 * deliberately never reach the agent tier. `GET /healthz` became the
 * gateway's own readiness answer in #1596: the CD smoke probes this origin,
 * so a container application that has not started (or was stopped) must still
 * report a healthy deploy. Every OTHER advertised operation keeps the strict
 * phantom-surface rule: exactly one agent receiver, never zero. */
const EDGE_NATIVE_OPERATIONS = new Set(["GET /healthz"]);

function operationKey(operation: AdvertisedOperation): string {
  return `${operation.method} ${operation.path}`;
}

function agentOperations(): AdvertisedOperation[] {
  return operations(readDocument("agent-openapi.json"));
}

/** The advertised Agent operations the agent tier must serve. */
function forwardedAgentOperations(): AdvertisedOperation[] {
  return agentOperations().filter((operation) => !EDGE_NATIVE_OPERATIONS.has(operationKey(operation)));
}

/** The advertised Agent operations the edge answers itself. */
function nativeAgentOperations(): AdvertisedOperation[] {
  return agentOperations().filter((operation) => EDGE_NATIVE_OPERATIONS.has(operationKey(operation)));
}

/** Drive the real gateway once and count the agent receivers the request
 * reached: the CONTAINER binding and the native agent tier (W1-7 #1256). */
async function agentReceivers(operation: AdvertisedOperation): Promise<number> {
  const captured: { req?: Request } = {};
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({ authenticate: authed, agentTurns: nativeAgentReceiver(calls) });
  const res = await app.request(concretePath(operation.path), { method: operation.method }, envWithContainer(captured), stubCtx);
  assert.equal(res.status !== 404, true, `${operationKey(operation)} must not 404`);
  return Number(captured.req !== undefined) + calls.length;
}

void test("every edge-native operation is still advertised in the Agent document", () => {
  const advertised = new Set(agentOperations().map(operationKey));
  assert.ok(EDGE_NATIVE_OPERATIONS.size > 0, "the edge-native table must name an operation, or this loop is vacuous");
  for (const key of EDGE_NATIVE_OPERATIONS) {
    assert.equal(advertised.has(key), true, `${key} is edge-native but no longer advertised — retire the entry here with it`);
  }
});

void test("every advertised edge-native operation is answered without the agent tier", async () => {
  const native = nativeAgentOperations();
  assert.ok(native.length > 0, "the edge-native table must name an advertised operation, or this loop is vacuous");
  assert.equal(native.length, EDGE_NATIVE_OPERATIONS.size, "each edge-native entry must name an advertised operation");
  for (const operation of native) {
    assert.equal(await agentReceivers(operation), 0, `${operationKey(operation)} is the edge's own answer, not the agent tier's`);
  }
});

void test("every advertised forwarded Agent operation reaches exactly one agent receiver", async () => {
  const forwarded = forwardedAgentOperations();
  assert.ok(forwarded.length > 0, "agent-openapi.json must advertise an operation the agent tier serves");
  for (const operation of forwarded) {
    assert.equal(await agentReceivers(operation), 1, `${operationKey(operation)} must reach exactly one agent receiver`);
  }
});

async function assertUsersOperationReachable(operation: AdvertisedOperation): Promise<void> {
  assert.equal(operation.path.startsWith(USERS_BINDING_PREFIX), true);
  const reached = { value: false };
  const app = createWorkerApp({ authenticate: authed });
  const env = usersEnv(usersBinding(reached));
  const res = await app.request(concretePath(operation.path), { method: operation.method }, env, stubCtx);
  assert.equal(res.status !== 404, true, `${operation.method} ${operation.path} must not 404`);
  assert.equal(reached.value, true, `${operation.method} ${operation.path} must reach the USERS binding`);
}

void test("every Users OpenAPI operation is reachable through the USERS binding", async () => {
  const usersOps = operations(readDocument("users-openapi.json"));
  assert.ok(usersOps.length > 0, "users-openapi.json must advertise operations");
  for (const operation of usersOps) {
    await assertUsersOperationReachable(operation);
  }
});
