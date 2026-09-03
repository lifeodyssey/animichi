import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { BOOLEAN_SWITCHES, MAX_TOKENS_FIELDS } from "../spike/pi/src/compat-switch.ts";

// W0-S2 (#1245): the measurement script is the deliverable the orchestrator
// runs against the real gateway, and a wrong matrix costs ~17 minutes per
// route before anyone notices. So the script is driven here against a stub
// that answers like the deployed Worker: the assertions are the exact request
// bodies it sends, the routes it skips, and the markdown table it prints.
//
// test-type: unit (the checked-in script over a loopback stub; no gateway).

const SCRIPT = fileURLToPath(new URL("../../../scripts/spike/pi-s2-compat.sh", import.meta.url));

const MEASUREMENT = {
  toolRoundTrip: true,
  streamingUsage: true,
  wallMs: 51902,
  firstTokenMs: 1204,
  events: ["agent_start", "agent_end"],
  error: null,
};

interface StubRun {
  compatBodies: string[];
  healthzCount: number;
  output: string;
  out: string;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      resolve(body);
    });
  });
}

function makeSpikeStub(mimoRoutes: Record<string, boolean>, seen: StubRun): Server {
  return createServer((request, response) => {
    if (request.url === "/healthz") {
      seen.healthzCount += 1;
      response.end(JSON.stringify({ ok: true, mimoRoutes }));
      return;
    }
    void readBody(request).then((body) => {
      seen.compatBodies.push(body);
      response.end(JSON.stringify(MEASUREMENT));
    });
  });
}

function listenOn(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

// The stub answers from this process's event loop, so the script has to run
// asynchronously: a synchronous spawn would block the very loop the stub needs
// to reply on, and the two would deadlock until curl gave up.
function runScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("bash", [SCRIPT, ...args], { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error === null) resolve(stdout);
      else reject(new Error(`pi-s2-compat.sh failed: ${error.message} ${stderr}`));
    });
  });
}

async function runMatrix(
  mimoRoutes: Record<string, boolean>,
  out = mkdtempSync(join(tmpdir(), "pi-s2-")),
): Promise<StubRun> {
  const seen: StubRun = { compatBodies: [], healthzCount: 0, output: "", out };
  const server = makeSpikeStub(mimoRoutes, seen);
  const port = await listenOn(server);
  seen.output = await runScript(["--url", `http://127.0.0.1:${String(port)}`, "--out", out]);
  server.close();
  return seen;
}

function evidencePathsIn(results: string): string[] {
  return [...results.matchAll(/evidence=(\S+)/g)].flatMap((match) => match[1] ?? []);
}

function compatOf(body: string): unknown {
  return (JSON.parse(body) as { compat: unknown }).compat;
}

function expectedCompats(): unknown[] {
  const booleans = BOOLEAN_SWITCHES.flatMap((name) => [{ [name]: true }, { [name]: false }]);
  const fields = MAX_TOKENS_FIELDS.map((value) => ({ maxTokensField: value }));
  return [{}, ...booleans, ...fields];
}

void test("the matrix runs the defaults case plus both values of every switch", async () => {
  const run = await runMatrix({ direct: true, zen: false });
  assert.deepEqual(run.compatBodies.map(compatOf), expectedCompats());
});

void test("every case names the route it was measured on", async () => {
  const run = await runMatrix({ direct: true, zen: false });
  const routes = new Set(run.compatBodies.map((body) => (JSON.parse(body) as { route: string }).route));
  assert.deepEqual([...routes], ["direct"]);
});

void test("a route with no key is skipped with a reason, not a failure", async () => {
  const run = await runMatrix({ direct: true, zen: false });
  assert.match(run.output, /\| zen \| - \| - \| skipped \| skipped \|/);
  assert.match(run.output, /no key for this route/);
});

void test("both routes are measured when both keys are present", async () => {
  const run = await runMatrix({ direct: true, zen: true });
  assert.equal(run.compatBodies.length, expectedCompats().length * 2);
});

void test("readiness is read once, not once per case", async () => {
  const run = await runMatrix({ direct: true, zen: true });
  assert.equal(run.healthzCount, 1);
});

void test("the printed table carries the header the spec table needs", async () => {
  const run = await runMatrix({ direct: true, zen: false });
  assert.ok(
    run.output.includes(
      "| route | switch | value | tool round trip | streaming usage | wall ms | first token ms | note |",
    ),
  );
});

void test("a measured row carries the numbers the response reported", async () => {
  const run = await runMatrix({ direct: true, zen: false });
  assert.match(run.output, /\| direct \| \(defaults\) \| auto \| yes \| yes \| 51902 \| 1204 \| events=2 /);
});

void test("every row names the response body it was read from", async () => {
  const run = await runMatrix({ direct: true, zen: false });
  const paths = evidencePathsIn(readFileSync(join(run.out, "results.txt"), "utf8"));
  assert.equal(paths.length, expectedCompats().length);
  assert.equal(new Set(paths).size, paths.length, "two rows must not share one file");
  for (const path of paths) assert.ok(existsSync(join(run.out, path)), `${path} is missing`);
});

// The bug this guards: a re-measured case used to overwrite the evidence
// behind the row already in results.txt, leaving two rows pointing at one file
// that only described the later run.
void test("re-measuring keeps the earlier run's evidence intact", async () => {
  const first = await runMatrix({ direct: true, zen: false });
  const second = await runMatrix({ direct: true, zen: false }, first.out);
  const results = readFileSync(join(first.out, "results.txt"), "utf8");
  const paths = evidencePathsIn(results);
  assert.equal(paths.length, expectedCompats().length * 2, "both runs are recorded");
  assert.equal(new Set(paths).size, paths.length, "no row's evidence was overwritten");
  for (const path of paths) assert.ok(existsSync(join(second.out, path)), `${path} is missing`);
});

function formatRows(records: string): string {
  return execFileSync("bash", [SCRIPT, "format"], { input: records, encoding: "utf8" });
}

void test("blank and commented lines never reach the table", () => {
  const records = "\n# a note the operator left\ndirect|supportsStore|false|yes|no|900|30|ok\n";
  assert.match(formatRows(records), /\| direct \| supportsStore \| false \| yes \| no \| 900 \| 30 \| ok \|/);
  assert.equal(formatRows(records).trim().split("\n").length, 3);
});

void test("a first token that never arrived is reported as none, not as zero", () => {
  const records = "direct|supportsStrictMode|true|no|no|1200|none|400 unsupported parameter\n";
  assert.match(formatRows(records), /\| none \| 400 unsupported parameter \|/);
});
