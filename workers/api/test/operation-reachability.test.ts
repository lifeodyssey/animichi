import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { alwaysAllowGuard, gatewayEnv, stubCtx } from "./doubles/entry-env.ts";
import { turnRoutePolicy } from "../src/gateway/routing-policy.ts";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";

// Issue #1005 AC1: every operation advertised by a generated OpenAPI document
// must be reachable through the edge's service binding route. The edge is the
// gateway — an advertised operation the edge 404s is a phantom surface. This
// test drives the real gateway (createWorkerApp) for every operation in the
// committed generated documents and asserts the request reaches the intended
// receiver (this Worker's native agent tier, or the USERS binding).
//
// #1605 deleted the container receiver this file used to partition against, and
// with it the last way an advertised operation could be served from outside this
// Worker: a marker-less Agent operation is now a native-tier route or a phantom.
//
// Issue #1601 added the second `x-runtime: "edge"` operation. That committed
// marker means the edge itself owns the runtime, so those operations must never
// be forwarded into a downstream agent runtime: the native stream reaches the
// edge's own agent tier, and the in-process adoption reaches no downstream
// receiver at all. Their expected receiver is derived from the production route
// policy, not a path list kept here.
//
// Issue #1596 added the edge's own readiness answer, which that marker cannot
// express: the container kept its own richer `/healthz` and mounted it, so
// `GET /healthz` had to stay in the generated Python inventory — the marker
// means "not a Python runtime route" and would have stripped it (its Python
// document is deleted with the rest of the tree in #1607). It is named in the
// table below instead, and pinned to the document by its own test.
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

function usersEnv(users: { fetch(req: Request): Promise<Response> }) {
  return { EDGE_SHOWCASE_MODE: "false", EDGE_GUARD: alwaysAllowGuard, USERS: users } as never;
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
 * answer in #1596: the CD smoke probes this origin, so a deploy whose agent
 * runtime has not started (or was stopped) must still report a healthy deploy.
 * Every OTHER advertised operation keeps the strict phantom-surface rule:
 * exactly one receiver, never zero. */
const EDGE_NATIVE_OPERATIONS = new Set(["GET /healthz"]);

function operationKey(operation: AdvertisedOperation): string {
  return `${operation.method} ${operation.path}`;
}

/** Whether the production route policy serves this operation on the edge's
 * own native agent tier (`/v1/chat`, the probe, the transcript and the stream). */
function isNativeTierRoute(operation: AdvertisedOperation): boolean {
  return turnRoutePolicy().select(operation.method, concretePath(operation.path)) !== null;
}

/** Who serves an advertised Agent operation, now that the edge carries no
 * container (#1605): this Worker's native agent tier, or the edge in process —
 * the `x-runtime: "edge"` marker with no native-tier route, plus the
 * marker-less edge-native table above. */
type AgentReceiver = "nativeTier" | "inProcess";

function agentReceiver(operation: AdvertisedOperation): AgentReceiver {
  if (EDGE_NATIVE_OPERATIONS.has(operationKey(operation))) return "inProcess";
  return isNativeTierRoute(operation) ? "nativeTier" : "inProcess";
}

/** Every advertised Agent operation that carries no `x-runtime` marker and is
 * not in the edge-native table — the set the phantom-surface rule governs
 * directly, because the marker was the container's routing decision. */
function markerlessOperations(): AdvertisedOperation[] {
  return operations(readDocument("agent-openapi.json"))
    .filter((operation) => operation.runtime !== "edge" && !EDGE_NATIVE_OPERATIONS.has(operationKey(operation)));
}

/** The advertised Agent operations grouped by the receiver they must reach. */
function receiverPartitions(): Record<AgentReceiver, AdvertisedOperation[]> {
  const partitions: Record<AgentReceiver, AdvertisedOperation[]> = { nativeTier: [], inProcess: [] };
  for (const operation of operations(readDocument("agent-openapi.json"))) partitions[agentReceiver(operation)].push(operation);
  return partitions;
}

interface AgentDriveResult {
  readonly calls: NativeAgentCall[];
  readonly label: string;
}

async function driveAgentOperation(operation: AdvertisedOperation): Promise<AgentDriveResult> {
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({ authenticate: authed, agentTurns: nativeAgentReceiver(calls) });
  const res = await app.request(concretePath(operation.path), { method: operation.method }, gatewayEnv(), stubCtx);
  const label = `${operation.method} ${operation.path}`;
  assert.equal(res.status !== 404, true, `${label} must not 404`);
  return { calls, label };
}

async function assertNativeTierReceiver(operation: AdvertisedOperation): Promise<void> {
  const { calls, label } = await driveAgentOperation(operation);
  assert.equal(calls.length, 1, `${label} must reach exactly one edge-native receiver`);
}

async function assertInProcessReceiver(operation: AdvertisedOperation): Promise<void> {
  const { calls, label } = await driveAgentOperation(operation);
  assert.equal(calls.length, 0, `${label} is served in process and must reach no native receiver`);
}

void test("every edge-native operation is still advertised in the Agent document", () => {
  const advertised = new Set(operations(readDocument("agent-openapi.json")).map(operationKey));
  assert.ok(EDGE_NATIVE_OPERATIONS.size > 0, "the edge-native table must name an operation, or this loop is vacuous");
  for (const key of EDGE_NATIVE_OPERATIONS) {
    assert.equal(advertised.has(key), true, `${key} is edge-native but no longer advertised — retire the entry here with it`);
  }
});

void test("every marker-less advertised Agent operation is a native-tier route", () => {
  const markerless = markerlessOperations();
  assert.equal(markerless.length > 0, true, "the document must advertise the marker-less routes this rule governs");
  for (const operation of markerless) {
    assert.equal(
      isNativeTierRoute(operation),
      true,
      `${operationKey(operation)} is advertised with no x-runtime marker and is not selected by turnRoutePolicy — the edge would 404 an advertised route`,
    );
  }
});

void test("every native-tier Agent operation reaches exactly one edge-native receiver", async () => {
  const { nativeTier } = receiverPartitions();
  assert.equal(nativeTier.length > 0, true, "the native-tier partition must not be empty");
  for (const operation of nativeTier) await assertNativeTierReceiver(operation);
});

void test("every in-process Agent operation reaches no downstream receiver", async () => {
  const { inProcess } = receiverPartitions();
  assert.equal(inProcess.length > 0, true, "the in-process partition must not be empty");
  for (const operation of inProcess) await assertInProcessReceiver(operation);
});

void test("the two receiver partitions cover every advertised Agent operation", () => {
  const { nativeTier, inProcess } = receiverPartitions();
  const advertised = operations(readDocument("agent-openapi.json"));
  assert.equal(nativeTier.length + inProcess.length, advertised.length);
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
