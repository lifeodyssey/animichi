import crypto from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EgressDeps } from "../src/egress-service.ts";
import { answerInboundRequest, type InboundRequest, type OutboundResponse } from "../src/request-boundary.ts";

/**
 * SUT: `answerInboundRequest`, driven with a request and a response this test
 * owns. A legitimate request is written exactly as the handler answers it,
 * whatever its Host says or lacks. A failure is answered without a second
 * throw however far the answer had got, and the returned promise resolves in
 * every case: the server's request listener discards it, so nothing else would
 * handle a rejection.
 */

const KEY = crypto.randomBytes(48).toString("base64");
const NOW_SECONDS = 1_700_000_000;
const UPSTREAM_BODY = '{"points":[]}';

function signedHeaders(path: string): Record<string, string> {
  const signature = crypto.createHmac("sha256", KEY).update(`${String(NOW_SECONDS)}\n${path}`).digest("hex");
  return { "x-egress-timestamp": String(NOW_SECONDS), "x-egress-signature": signature };
}

/** Everything the response was told: each head written, each body ended with, and how often it was closed. */
interface ResponseRecord {
  heads: { status: number; headers: Record<string, string> }[];
  bodies: string[];
  destroyed: number;
}

/** What runs before the response records a call: nothing, or a throw, as node:http's own calls can throw. */
interface ResponseSteps {
  writeHead: () => void;
  end: () => void;
}

const WRITABLE: ResponseSteps = { writeHead: () => undefined, end: () => undefined };

/** A response that records what it is told, each call running its step first. */
function recordingResponse(steps: ResponseSteps = WRITABLE): { response: OutboundResponse; record: ResponseRecord } {
  const record: ResponseRecord = { heads: [], bodies: [], destroyed: 0 };
  const response: OutboundResponse = {
    get headersSent() { return record.heads.length > 0; },
    writeHead: (status, headers) => { steps.writeHead(); record.heads.push({ status, headers }); },
    end: (body) => { steps.end(); record.bodies.push(new TextDecoder().decode(body)); },
    destroy: () => { record.destroyed += 1; },
  };
  return { response, record };
}

function deps(overrides: Partial<EgressDeps> = {}): EgressDeps {
  return {
    config: { currentKey: KEY, previousKey: null, ceilingPerHour: 100 },
    ceiling: { tryAcquire: () => Promise.resolve("granted") },
    upstreamFetch: () => Promise.resolve(new Response(UPSTREAM_BODY, { status: 200 })),
    nowSeconds: () => NOW_SECONDS,
    ...overrides,
  };
}

/** A GET signed over `path`, its target `path` plus `query`, with `headers` beside the signature. */
function signedGet(path: string, options: { query?: string; headers?: Record<string, string | string[]> } = {}): InboundRequest {
  return { method: "GET", url: `${path}${options.query ?? ""}`, headers: { ...signedHeaders(path), ...options.headers } };
}

/** The Host the platform's proxy sends: the app's public name. */
const PLATFORM_HOST = { host: "animichi-anitabi-egress.fly.dev" };

function stoppedClock(): number {
  throw new Error("the injected clock failed");
}

void describe("a legitimate request through the boundary", () => {
  const legitimate: { name: string; request: InboundRequest }[] = [
    { name: "a signed GET for the points operation", request: signedGet("/anitabi/points/2461", { headers: PLATFORM_HOST }) },
    { name: "a signed GET for the lite operation", request: signedGet("/anitabi/lite/10380", { headers: PLATFORM_HOST }) },
    { name: "a GET carrying a query", request: signedGet("/anitabi/lite/2461", { query: "?unused=1", headers: PLATFORM_HOST }) },
    { name: "a GET with no Host at all, as HTTP/1.0 may send", request: signedGet("/anitabi/lite/2461") },
    {
      name: "a GET whose header arrived twice",
      request: signedGet("/anitabi/lite/2461", { headers: { ...PLATFORM_HOST, accept: ["application/json", "text/plain"] } }),
    },
  ];

  for (const { name, request } of legitimate) {
    void it(`writes ${name} as the relayed answer`, async () => {
      const { response, record } = recordingResponse();
      await answerInboundRequest(request, response, deps(), () => undefined);
      assert.deepEqual(record.heads.map((head) => [head.status, head.headers["x-egress-response"]]), [[200, "relayed-upstream"]]);
      assert.deepEqual(record.bodies, [UPSTREAM_BODY]);
    });
  }

  void it("writes the handler's own auth refusal for an unsigned GET", async () => {
    const { response, record } = recordingResponse();
    await answerInboundRequest({ method: "GET", url: "/anitabi/lite/2461", headers: {} }, response, deps(), () => undefined);
    assert.deepEqual(record.heads.map((head) => [head.status, head.headers["x-egress-refusal"]]), [[401, "auth"]]);
  });
});

void describe("a failure, however far its answer had got", () => {
  void it("writes a plain 500 and one line while nothing has been sent", async () => {
    const lines: string[] = [];
    const { response, record } = recordingResponse();
    await assert.doesNotReject(answerInboundRequest(signedGet("/anitabi/lite/2461"), response, deps({ nowSeconds: stoppedClock }), (line) => { lines.push(line); }));
    assert.deepEqual(record.heads, [{ status: 500, headers: {} }]);
    assert.equal(lines.length, 1);
  });

  void it("closes the connection, and writes no second head, once the answer's head was sent", async () => {
    const lines: string[] = [];
    const { response, record } = recordingResponse({ ...WRITABLE, end: () => { throw new Error("the socket went away"); } });
    await assert.doesNotReject(answerInboundRequest(signedGet("/anitabi/lite/2461"), response, deps(), (line) => { lines.push(line); }));
    assert.deepEqual(record.heads.map((head) => head.status), [200]);
    assert.equal(record.destroyed, 1);
    assert.equal(lines.length, 1);
  });

  void it("closes the connection when even the 500 cannot be written", async () => {
    const { response, record } = recordingResponse({ ...WRITABLE, writeHead: () => { throw new Error("no head can be written"); } });
    await assert.doesNotReject(answerInboundRequest(signedGet("/anitabi/lite/2461"), response, deps(), () => undefined));
    assert.equal(record.destroyed, 1);
  });

  void it("still writes the 500 when the log sink throws", async () => {
    const { response, record } = recordingResponse();
    const throwingSink = (): void => { throw new Error("the log stream is closed"); };
    await assert.doesNotReject(answerInboundRequest(signedGet("/anitabi/lite/2461"), response, deps({ nowSeconds: stoppedClock }), throwingSink));
    assert.deepEqual(record.heads, [{ status: 500, headers: {} }]);
  });

  void it("logs a thrown value that is not an error by its type and its text", async () => {
    const lines: string[] = [];
    const thrown: unknown = "a plain string";
    const { response } = recordingResponse();
    await answerInboundRequest(signedGet("/anitabi/lite/2461"), response, deps({ nowSeconds: () => { throw thrown; } }), (line) => { lines.push(line); });
    assert.deepEqual(JSON.parse(lines[0] ?? ""), { event: "request-failure", error: "string", message: "a plain string", stack: "" });
  });
});
