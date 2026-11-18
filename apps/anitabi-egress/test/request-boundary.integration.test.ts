import crypto from "node:crypto";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { startEgressServer, type EgressServerOptions } from "../src/start-egress-server.ts";

/**
 * SUT: the service's request boundary over real loopback HTTP. Whatever
 * node:http delivers gets an HTTP answer, and the service goes on answering
 * the request after it.
 *
 * These requests are ones `fetch` will not send: a method it refuses to issue,
 * a target that is not a path, a Host it would rewrite. They go out through
 * node:http's own client, which writes the method, the target and the Host as
 * given. The upstream answers in-process: the relay is not this suite's subject.
 */

const KEY = crypto.randomBytes(48).toString("base64");
const NOW_SECONDS = 1_700_000_000;
const PATH = "/anitabi/lite/2461";

/** One request, written as given. */
interface Asked {
  method: string;
  target: string;
  headers?: Record<string, string>;
}

/** One answer, reduced to what the assertions read. */
interface Answered {
  status: number;
  marker: string | undefined;
  refusal: string | undefined;
  allow: string | undefined;
}

function signedHeaders(path: string): Record<string, string> {
  const signature = crypto.createHmac("sha256", KEY).update(`${String(NOW_SECONDS)}\n${path}`).digest("hex");
  return { "x-egress-timestamp": String(NOW_SECONDS), "x-egress-signature": signature };
}

/** The signed GET the service must still serve after whatever came before it. */
const LEGITIMATE: Asked = { method: "GET", target: PATH, headers: signedHeaders(PATH) };

function answered(response: IncomingMessage): Answered {
  const marker = response.headers["x-egress-response"];
  const refusal = response.headers["x-egress-refusal"];
  const status = response.statusCode ?? 0;
  return { status, marker: marker?.toString(), refusal: refusal?.toString(), allow: response.headers.allow };
}

/**
 * How long a request may go unanswered before that is the failure. Not a
 * measurement: every answer here arrives in milliseconds, and the bound turns
 * a request the service never answers into a failed test instead of an open
 * connection that holds the suite for ever.
 */
const ANSWER_DEADLINE_MS = 5_000;

/** Ask the running service on a connection of its own. */
function ask(port: number, asked: Asked): Promise<Answered> {
  return new Promise((resolve, reject) => {
    const target = { host: "127.0.0.1", port, agent: false, timeout: ANSWER_DEADLINE_MS };
    const outgoing = httpRequest({ ...target, method: asked.method, path: asked.target, headers: asked.headers }, (response) => {
      response.resume();
      response.on("end", () => { resolve(answered(response)); });
    });
    outgoing.on("timeout", () => { outgoing.destroy(new Error(`no answer to ${asked.method} ${asked.target}`)); });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function startService(overrides: Partial<EgressServerOptions> = {}): Promise<{ server: Server; port: number }> {
  return startEgressServer({
    env: { INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: "100" },
    port: 0,
    nowSeconds: () => NOW_SECONDS,
    upstreamFetch: () => Promise.resolve(new Response('{"points":[]}', { status: 200 })),
    ceilingStore: { increment: () => Promise.resolve(1) },
    ...overrides,
  });
}

function refusedWith(status: number, refusal: string, allow?: string): Answered {
  return { status, marker: "refused-here", refusal, allow };
}

void describe("a request the service cannot serve, answered before anything is lifted", () => {
  let service: { server: Server; port: number };

  before(async () => {
    service = await startService();
  });

  after(() => {
    service.server.close();
  });

  for (const method of ["TRACE", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "PROPFIND"]) {
    void it(`refuses ${method} with 405 and Allow: GET, and serves the signed GET after it`, async () => {
      const refused = await ask(service.port, { method, target: PATH, headers: signedHeaders(PATH) });
      const served = await ask(service.port, LEGITIMATE);
      assert.deepEqual(refused, refusedWith(405, "method-not-allowed", "GET"));
      assert.equal(served.status, 200);
    });
  }

  const unreadable: { name: string; asked: Asked; answer: Answered }[] = [
    { name: "OPTIONS *", asked: { method: "OPTIONS", target: "*" }, answer: refusedWith(405, "method-not-allowed", "GET") },
    { name: "GET *:99999", asked: { method: "GET", target: "*:99999" }, answer: refusedWith(404, "no-such-operation") },
    { name: "GET *@x", asked: { method: "GET", target: "*@x" }, answer: refusedWith(404, "no-such-operation") },
    {
      name: "an absolute-form target with credentials, under a Host with a port",
      asked: { method: "GET", target: `http://u:p@127.0.0.1:8${PATH}` },
      answer: refusedWith(404, "no-such-operation"),
    },
    ...["a b", "[", "%zz", "x:99999", "a@b", "u:p@b"].map((host) => ({
      name: `Host: ${host}, which is never parsed`,
      asked: { method: "GET", target: PATH, headers: { host } },
      answer: refusedWith(401, "auth"),
    })),
  ];

  for (const { name, asked, answer } of unreadable) {
    void it(`answers ${name} and serves the signed GET after it`, async () => {
      const first = await ask(service.port, asked);
      const served = await ask(service.port, LEGITIMATE);
      assert.deepEqual(first, answer);
      assert.equal(served.status, 200);
    });
  }
});

/** A clock the test can stop and restart: the one dependency every request reads. */
function stoppableClock(): { nowSeconds: () => number; stopWith(failure: Error): void; restart(): void } {
  const running = (): number => NOW_SECONDS;
  let reading = running;
  return {
    nowSeconds: () => reading(),
    stopWith: (failure) => { reading = () => { throw failure; }; },
    restart: () => { reading = running; },
  };
}

const FAILURE_NAME = `InjectedClockFailure${"x".repeat(2000)}`;
const FAILURE_MESSAGE = "the injected clock failed: ";
const PROBE_PATH = "/anitabi/lite/987654321";
const PROBE: Asked = {
  method: "GET",
  target: `${PROBE_PATH}?probe=probe-query-value`,
  headers: { ...signedHeaders(PROBE_PATH), "x-probe": "probe-header-value" },
};

void describe("a failure inside the handling path", () => {
  const lines: string[] = [];
  const clock = stoppableClock();
  let service: { server: Server; port: number };
  let failed: Answered;
  let served: Answered;

  before(async () => {
    service = await startService({ nowSeconds: clock.nowSeconds, logSink: (line) => { lines.push(line); } });
    clock.stopWith(Object.assign(new Error(`${FAILURE_MESSAGE}${"x".repeat(2000)}`), { name: FAILURE_NAME }));
    failed = await ask(service.port, PROBE);
    clock.restart();
    served = await ask(service.port, LEGITIMATE);
  });

  after(() => {
    service.server.close();
  });

  void it("is answered with a plain 500 carrying no marker, and the next request is served", () => {
    assert.deepEqual(failed, { status: 500, marker: undefined, refusal: undefined, allow: undefined });
    assert.equal(served.status, 200);
  });

  void it("is written as exactly one line: the failure's name, its message and its stack, each capped at 500", () => {
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /^[^\n]+\n$/);
    const line = JSON.parse(lines[0] ?? "") as { event: string; error: string; message: string; stack: string };
    assert.deepEqual(Object.keys(line).sort(), ["error", "event", "message", "stack"]);
    assert.equal(line.event, "request-failure");
    assert.equal(line.error, FAILURE_NAME.slice(0, 500));
    assert.ok(line.message.startsWith(FAILURE_MESSAGE));
    assert.equal(line.message.length, 500);
    assert.equal(line.stack.length, 500);
  });

  void it("carries none of the request's path, query or headers", () => {
    assert.doesNotMatch(lines[0] ?? "", /987654321|probe-query-value|probe-header-value/);
  });
});
