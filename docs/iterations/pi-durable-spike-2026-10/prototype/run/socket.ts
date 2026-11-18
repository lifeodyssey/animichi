/**
 * Way 11 for sockets, recorded. Run only under the sandbox profile (`../no-network.sb`): it allows outbound
 * connections to loopback and unix sockets and denies the rest. From Node, then from workerd (with the same outbound
 * guard every other run installs): a connect to a loopback listener this runner owns must succeed, and a connect to
 * 192.0.2.1 (TEST-NET-1, never routed) must be refused at once. Nothing here is run outside the sandbox for comparison.
 * Writes `../evidence/q2-sockets.json`, then exits non-zero if any check failed.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle, PROTOTYPE } from "./bundle.ts";
import { OutboundGuard, WorkerdLog, startWorkerd, writeEvidence } from "./workerd.ts";

const TEST_NET = "192.0.2.1";
const POSTGRES_PORT = 5432;

interface Attempt { readonly host: string; readonly port: number; readonly outcome: string; readonly elapsedMs: number; readonly code?: string; readonly message?: string }

function nodeConnect(host: string, port: number): Promise<Attempt> {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (outcome: Omit<Attempt, "host" | "port" | "elapsedMs">) => {
      socket.destroy();
      resolve({ host, port, elapsedMs: Math.round((performance.now() - started) * 10) / 10, ...outcome });
    };
    socket.once("connect", () => done({ outcome: "connected" }));
    socket.once("error", (error: NodeJS.ErrnoException) => done({ outcome: "refused", code: error.code, message: error.message }));
    socket.setTimeout(5_000, () => done({ outcome: "timed-out" }));
  });
}

const accepted: { at: number; remote: string | undefined }[] = [];
const listener = createServer((socket) => { accepted.push({ at: Date.now(), remote: socket.remoteAddress }); socket.end(); });
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
const loopbackPort = (listener.address() as AddressInfo).port;

const node = { loopback: await nodeConnect("127.0.0.1", loopbackPort), testNet: await nodeConnect(TEST_NET, POSTGRES_PORT) };
const acceptedAfterNode = accepted.length;

const work = mkdtempSync(join(tmpdir(), "pi-durable-spike-socket-"));
const built = await bundle("q2/socket.worker.ts", work);
const log = new WorkerdLog();
const guard = new OutboundGuard();
const mf = startWorkerd(built, { run: "socket", persist: join(work, "persist"), log, guard, durableObjects: {} });
const ask = async (host: string, port: number) => {
  const response = await mf.dispatchFetch(`https://probe.test/connect?host=${host}&port=${String(port)}`);
  return await response.json() as { outcome: string; elapsedMs: number; error?: string };
};
let workerd;
let linesDuringTestNet: string[];
try {
  const loopback = await ask("127.0.0.1", loopbackPort);
  const before = log.lines.length;
  const testNet = await ask(TEST_NET, POSTGRES_PORT);
  linesDuringTestNet = log.lines.slice(before).map((line) => `${line.stream}: ${line.text}`);
  workerd = { loopback, testNet };
} finally {
  await mf.dispose();
  listener.close();
}

const checks: { readonly name: string; readonly pass: boolean; readonly observed: unknown }[] = [];
const check = (name: string, pass: boolean, observed: unknown) => { checks.push({ name, pass, observed }); };
check("node: the loopback connect succeeds, and the listener accepts it", node.loopback.outcome === "connected" && acceptedAfterNode === 1, node.loopback);
check("node: the connect to 192.0.2.1 is refused with EPERM within 100 ms (a refusal, not a timeout)",
  node.testNet.outcome === "refused" && node.testNet.code === "EPERM" && node.testNet.elapsedMs < 100, node.testNet);
check("workerd: the loopback connect opens, and the listener accepts it", workerd.loopback.outcome === "opened" && accepted.length === 2, workerd.loopback);
check("workerd: the connect to 192.0.2.1 fails within 1 s (not the 5 s timeout)", workerd.testNet.outcome === "refused" && workerd.testNet.elapsedMs < 1_000,
  workerd.testNet);
check("guard: the fetch guard saw neither socket", guard.violations.length === 0 && guard.catalogCalls.length === 0, guard.violations);
const sandboxNamed = /not permitted|EPERM/i.test(`${workerd.testNet.error ?? ""}\n${linesDuringTestNet.join("\n")}`);

writeEvidence("q2-sockets.json", {
  runtime: built.runtime,
  sandboxProfile: readFileSync(join(PROTOTYPE, "no-network.sb"), "utf8").split("\n").filter((line) => line !== ""),
  node, workerd, acceptedConnections: accepted.length, workerdLinesDuringTestNetConnect: linesDuringTestNet,
  workerdErrorNamesTheSandbox: sandboxNamed, checks,
});
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
console.log(JSON.stringify({ node, workerd, workerdErrorNamesTheSandbox: sandboxNamed }));
process.exitCode = checks.every((item) => item.pass) ? 0 : 1;
