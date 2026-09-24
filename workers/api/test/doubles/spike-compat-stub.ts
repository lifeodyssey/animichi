// A stand-in for the deployed spike Worker, used to drive the real
// `scripts/spike/pi-s2-compat.sh` under node:test (#1245). It answers
// `/healthz` and `/compat` the way the Worker does, records the request bodies
// the script sent, and lets a test choose what the gateway says back — a long
// provider error, a non-200, or the ordinary measurement.
//
// It is a stub for the *transport*, not for the script: every assertion made
// against it is about the checked-in shell, which runs here exactly as the
// owner runs it against the real gateway.

import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

export const SCRIPT = fileURLToPath(
  new URL("../../../../scripts/spike/pi-s2-compat.sh", import.meta.url),
);

export const MEASUREMENT = {
  toolRoundTrip: true,
  streamingUsage: true,
  wallMs: 51902,
  firstTokenMs: 1204,
  events: ["agent_start", "agent_end"],
  error: null,
};

export interface StubResponse {
  status: number;
  body: unknown;
}

const MEASURED: StubResponse = { status: 200, body: MEASUREMENT };

export interface StubRun {
  compatBodies: string[];
  healthzCount: number;
  output: string;
  out: string;
}

export interface StubOptions {
  mimoRoutes: Record<string, boolean>;
  out?: string;
  response?: StubResponse;
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

function makeSpikeStub(options: StubOptions, seen: StubRun): Server {
  const answer = options.response ?? MEASURED;
  return createServer((request, response) => {
    if (request.url === "/healthz") {
      seen.healthzCount += 1;
      response.end(JSON.stringify({ ok: true, mimoRoutes: options.mimoRoutes }));
      return;
    }
    void readBody(request).then((body) => {
      seen.compatBodies.push(body);
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body));
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
export function runScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("bash", [SCRIPT, ...args], { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error === null) resolve(stdout);
      else reject(new Error(`pi-s2-compat.sh failed: ${error.message} ${stderr}`));
    });
  });
}

/** Runs the whole matrix against the stub and hands back what each side saw. */
export async function runMatrix(options: StubOptions): Promise<StubRun> {
  const out = options.out ?? mkdtempSync(join(tmpdir(), "pi-s2-"));
  const seen: StubRun = { compatBodies: [], healthzCount: 0, output: "", out };
  const server = makeSpikeStub(options, seen);
  const port = await listenOn(server);
  seen.output = await runScript(["--url", `http://127.0.0.1:${String(port)}`, "--out", out]);
  server.close();
  return seen;
}

export function evidencePathsIn(results: string): string[] {
  return [...results.matchAll(/evidence=(\S+)/g)].flatMap((match) => match[1] ?? []);
}
