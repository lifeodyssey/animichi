import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { alwaysAllowGuard, envWithContainer, stubCtx } from "../src/container/entry-env.ts";
import { turnRoutePolicy } from "../src/gateway/routing-policy.ts";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";

// Issue #1005 AC1: every operation advertised by a generated OpenAPI document
// must be reachable through the edge's service binding route. The edge is the
// gateway — an advertised operation the edge 404s is a phantom surface. This
// test drives the real gateway (createWorkerApp) for every operation in the
// committed generated documents and asserts the request reaches the intended
// binding (CONTAINER for Agent, USERS for the Users service).
//
// Issue #1601 added the second `x-runtime: "edge"` operation. That committed
// marker means the edge itself owns the runtime, so those operations must never
// be forwarded into the Python container: the native stream reaches the edge's
// own agent tier, and the in-process adoption reaches no downstream receiver at
// all. Their expected receiver is derived from the production route policy, not
// a path list kept here.
//
// Issue #1596 added the edge's own readiness answer, which that marker cannot
// express: the container keeps its own richer `/healthz` and still mounts it, so
// `GET /healthz` must stay in the generated Python inventory — the marker means
// "not a Python runtime route" and would strip it (see
// `apps/agent/src/animichi/tests/unit/test_agent_route_parity.py`). It is named
// in the table below instead, and pinned to the document by its own test.
//
// Each receiver class is a partition with its own test and its own straight-line
// assertions: an operation never picks which assertion runs.

const PACKAGE_DIR = fileURLToPath(new URL("../../../packages/contract", import.meta.url));
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

interface AdvertisedOperation {
  readonly method: string;
  readonly path: string;
  /** The committed `x-runtime` marker, when the document declares one. */
  readonly runtime: string | undefined;
}

interface AdvertisedDocument {
  readonly paths: Record<string, Record<string, Record<string, unknown>>>;
}

function readDocument(filename: string): AdvertisedDocument {
  return JSON.parse(readFileSync(`${PACKAGE_DIR}/${filename}`, "utf8")) as AdvertisedDocument;
}

function runtimeMarker(operation: Record<string, unknown>): string | undefined {
  const marker = operation["x-runtime"];
  return typeof marker === "string" ? marker : undefined;
}

function operations(document: AdvertisedDocument): AdvertisedOperation[] {
  const result: AdvertisedOperation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of Object.keys(item).filter((key) => HTTP_METHODS.has(key))) {
      result.push({ method: method.toUpperCase(), path, runtime: runtimeMarker(item[method] ?? {}) });
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

/** The advertised Agent operations the edge answers itself *without* the
 * `x-runtime: "edge"` marker. `GET /healthz` became the gateway's own readiness
 * answer in #1596: the CD smoke probes this origin, so a container application
 * that has not started (or was stopped) must still report a healthy deploy.
 * Every OTHER advertised operation keeps the strict phantom-surface rule:
 * exactly one agent receiver, never zero. */
const EDGE_NATIVE_OPERATIONS = new Set(["GET /healthz"]);

function operationKey(operation: AdvertisedOperation): string {
  return `${operation.method} ${operation.path}`;
}

/** Whether the production route policy serves this operation on the edge's
 * own native agent tier (`/v1/chat`, the probe, the transcript and the stream). */
function isNativeTierRoute(operation: AdvertisedOperation): boolean {
  return turnRoutePolicy().select(operation.method, concretePath(operation.path)) !== null;
}

/** Who serves an advertised Agent operation: the Python container, the edge's
 * native agent tier, or the edge in process — the `x-runtime: "edge"` marker
 * with no native-tier route, plus the marker-less edge-native table above. */
type AgentReceiver = "container" | "nativeTier" | "inProcess";

function agentReceiver(operation: AdvertisedOperation): AgentReceiver {
  if (EDGE_NATIVE_OPERATIONS.has(operationKey(operation))) return "inProcess";
  if (operation.runtime !== "edge") return "container";
  return isNativeTierRoute(operation) ? "nativeTier" : "inProcess";
}

/** The advertised Agent operations grouped by the receiver they must reach. */
function receiverPartitions(): Record<AgentReceiver, AdvertisedOperation[]> {
  const partitions: Record<AgentReceiver, AdvertisedOperation[]> = { container: [], nativeTier: [], inProcess: [] };
  for (const operation of operations(readDocument("agent-openapi.json"))) partitions[agentReceiver(operation)].push(operation);
  return partitions;
}

interface AgentDriveResult {
  readonly captured: { req?: Request };
  readonly calls: NativeAgentCall[];
  readonly label: string;
}

async function driveAgentOperation(operation: AdvertisedOperation): Promise<AgentDriveResult> {
  const captured: { req?: Request } = {};
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({ authenticate: authed, agentTurns: nativeAgentReceiver(calls) });
  const res = await app.request(concretePath(operation.path), { method: operation.method }, envWithContainer(captured), stubCtx);
  const label = `${operation.method} ${operation.path}`;
  assert.equal(res.status !== 404, true, `${label} must not 404`);
  return { captured, calls, label };
}

async function assertContainerReceiver(operation: AdvertisedOperation): Promise<void> {
  const { captured, calls, label } = await driveAgentOperation(operation);
  assert.equal(Number(captured.req !== undefined) + calls.length, 1, `${label} must reach exactly one agent receiver`);
}

async function assertNativeTierReceiver(operation: AdvertisedOperation): Promise<void> {
  const { captured, calls, label } = await driveAgentOperation(operation);
  assert.equal(captured.req, undefined, `${label} is edge-owned and must not reach the agent container`);
  assert.equal(calls.length, 1, `${label} must reach exactly one edge-native receiver`);
}

async function assertInProcessReceiver(operation: AdvertisedOperation): Promise<void> {
  const { captured, calls, label } = await driveAgentOperation(operation);
  assert.equal(captured.req, undefined, `${label} is edge-owned and must not reach the agent container`);
  assert.equal(calls.length, 0, `${label} is served in process and must reach no native receiver`);
}

void test("every edge-native operation is still advertised in the Agent document", () => {
  const advertised = new Set(operations(readDocument("agent-openapi.json")).map(operationKey));
  assert.ok(EDGE_NATIVE_OPERATIONS.size > 0, "the edge-native table must name an operation, or this loop is vacuous");
  for (const key of EDGE_NATIVE_OPERATIONS) {
    assert.equal(advertised.has(key), true, `${key} is edge-native but no longer advertised — retire the entry here with it`);
  }
});

void test("every container-forwarded Agent operation reaches exactly one agent receiver", async () => {
  const { container } = receiverPartitions();
  assert.equal(container.length > 0, true, "the container partition must not be empty");
  for (const operation of container) await assertContainerReceiver(operation);
});

void test("every edge-owned native-tier Agent operation reaches only the native receiver", async () => {
  const { nativeTier } = receiverPartitions();
  assert.equal(nativeTier.length > 0, true, "the native-tier partition must not be empty");
  for (const operation of nativeTier) await assertNativeTierReceiver(operation);
});

void test("every in-process Agent operation reaches no downstream receiver", async () => {
  const { inProcess } = receiverPartitions();
  assert.equal(inProcess.length > 0, true, "the in-process partition must not be empty");
  for (const operation of inProcess) await assertInProcessReceiver(operation);
});

void test("the three receiver partitions cover every advertised Agent operation", () => {
  const { container, nativeTier, inProcess } = receiverPartitions();
  const advertised = operations(readDocument("agent-openapi.json"));
  assert.equal(container.length + nativeTier.length + inProcess.length, advertised.length);
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
