import { createServer, type AddressInfo, type Socket } from "node:net";
import { NeonDbError, neonConfig } from "@neondatabase/serverless";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NEON_CALL_DEADLINE_MS } from "../../src/neon-deadline";
import { redactedCause } from "../../src/redacted-cause";
import { callTimedOut, provisionServiceRoles } from "../../src/service-roles";
import { SERVICE_ROLE_PASSWORDS } from "../service-role-passwords";

/* #1958's real-transport half: `service-roles.ts` reads a call's deadline off
 * `NeonDbError.sourceError.name === "TimeoutError"`, and every other arm builds that rejection
 * itself (`reject(abortReason(signal))`), so none proves the driver and the platform hand that
 * name back for a REAL timeout. Here a socket accepts and never answers, so the fetch, the
 * driver's wrap and the name it carries are all the platform's.
 */

const BASE_DSN = "postgresql://migrator:pw@ep-x.neon.tech/neondb";
/** Short enough for the plain-node budget: the socket never answers, so only the abort ends it. */
const STALL_MS = 250;

let server: ReturnType<typeof createServer> | undefined;
/** The abort leaves the server-side socket open, so the hook closes them, not `close()` alone. */
const sockets = new Set<Socket>();

beforeEach(async () => {
  sockets.clear();
  const listener = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => { sockets.delete(socket); });
  });
  server = listener;
  await new Promise<void>((listening) => { listener.listen(0, "127.0.0.1", listening); });
  const { port } = listener.address() as AddressInfo;
  // The endpoint override points the real driver's `fetch` — the platform's, not a double — at
  // the silent socket; the DSN's own host only has to parse.
  neonConfig.fetchEndpoint = `http://127.0.0.1:${String(port)}/sql`;
});

afterEach(async () => {
  neonConfig.fetchEndpoint = neonConfig.defaults.fetchEndpoint;
  vi.restoreAllMocks();
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((closed) => { server?.close(() => { closed(); }); });
});

it("reads a real fetch timeout through the driver as the call's deadline, not a stale password", async () => {
  const real = AbortSignal.timeout.bind(AbortSignal);
  const delays: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((delay: number) => {
    delays.push(delay);
    return real(Math.min(delay, STALL_MS));
  });
  const thrown = await provisionServiceRoles(BASE_DSN, SERVICE_ROLE_PASSWORDS).then(
    () => undefined,
    (error: unknown) => error,
  );
  // The three login probes never reach the batch, so exactly their deadlines were created.
  expect(delays).toEqual(Array.from({ length: 3 }, () => NEON_CALL_DEADLINE_MS));
  const cause = (thrown as Error).cause;
  expect(cause).toBeInstanceOf(NeonDbError);
  expect((cause as NeonDbError).sourceError?.name).toBe("TimeoutError");
  expect(callTimedOut(thrown)).toBe(true);
  expect(redactedCause(thrown)).toMatch(/^authenticates (agent_svc|catalog_svc|users_svc): /);
});
