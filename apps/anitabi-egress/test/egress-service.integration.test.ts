import crypto from "node:crypto";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer as createHttpServer, type Server } from "node:http";
import { startEgressServer } from "../src/start-egress-server.ts";
import { ANITABI_UPSTREAM_ORIGIN } from "../src/upstream-operations.ts";

/**
 * The service end to end over real loopback HTTP (#1792): the two operations
 * work, signed requests are honored, everything else is refused. The only
 * "upstream" is a stub bound to 127.0.0.1 that this test controls: the
 * service still builds and names the real anitabi URL, and the test's
 * transport shim — the same injectable-fetch seam the unit tests and the
 * catalog caller use — moves the bytes to the stub. No test reaches the real
 * anitabi API.
 */

const KEY = crypto.randomBytes(48).toString("base64");

/** One response, reduced to what the assertions read. */
interface AnswerShape {
  status: number;
  body: string;
  marker: string | null;
  refusal: string | null;
}

/** Signed request headers for `path` at `at`. */
function signedHeaders(path: string, at: number): Record<string, string> {
  return { "x-egress-timestamp": String(at), "x-egress-signature": sign(path, at) };
}

/** Ask the running service over real loopback HTTP. */
function ask(port: number, path: string, headers: Record<string, string>): Promise<AnswerShape> {
  return fetch(`http://127.0.0.1:${String(port)}${path}`, { headers })
    .then(async (res) => ({
      status: res.status,
      body: await res.text(),
      marker: res.headers.get("x-egress-response"),
      refusal: res.headers.get("x-egress-refusal"),
    }));
}

function sign(path: string, at: number): string {
  return crypto.createHmac("sha256", KEY).update(`${String(at)}\n${path}`).digest("hex");
}

/** The stub upstream, plus the fetch shim that serves anitabi URLs from it. */
interface StubUpstream {
  server: Server;
  shim: typeof fetch;
  requests: string[];
  /** Arm this stub to answer with a 302 to `target`; `null` restores the ordinary answer. */
  answerWithRedirect(target: string | null): void;
}

async function startStubUpstream(): Promise<StubUpstream> {
  const requests: string[] = [];
  let redirectTo: string | null = null;
  const server = createHttpServer((_request, response) => {
    if (redirectTo !== null) {
      response.writeHead(302, { location: redirectTo });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"points":[{"id":"p1"}],"pointsLength":1}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const stubBase = `http://127.0.0.1:${String(address.port)}`;
  const shim: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // The service must still be naming the real upstream — only the
    // transport moves, never the destination the service built.
    assert.ok(url.startsWith(`${ANITABI_UPSTREAM_ORIGIN}/`), `the service built ${url}`);
    requests.push(url);
    return fetch(`${stubBase}${new URL(url).pathname}${new URL(url).search}`, init);
  };
  return { server, shim, requests, answerWithRedirect: (target) => { redirectTo = target; } };
}

/** A second destination, standing in for whatever an upstream `Location` might name. */
interface SecondDestination {
  server: Server;
  url: string;
  contacted: string[];
}

async function startSecondDestination(): Promise<SecondDestination> {
  const contacted: string[] = [];
  const server = createHttpServer((request, response) => {
    contacted.push(request.url ?? "/");
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("not the upstream");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return { server, url: `http://127.0.0.1:${String(address.port)}/second-destination`, contacted };
}

void describe("the egress service over real HTTP", () => {
  let service: { server: Server; port: number };
  let stub: Awaited<ReturnType<typeof startStubUpstream>>;
  const nowSeconds = () => 1_700_000_000;

  before(async () => {
    stub = await startStubUpstream();
    service = await startEgressServer({
      env: { INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: "100" },
      port: 0,
      nowSeconds,
      upstreamFetch: stub.shim,
    });
  });

  after(() => {
    service.server.close();
    stub.server.close();
  });

  function request(path: string, signIt: boolean): Promise<AnswerShape> {
    return ask(service.port, path, signIt ? signedHeaders(path, nowSeconds()) : {});
  }

  void it("serves the points operation, signed, end to end", async () => {
    const answer = await request("/anitabi/points/2461", true);
    assert.equal(answer.status, 200);
    assert.equal(answer.marker, "relayed-upstream");
    assert.match(answer.body, /"points":\[/);
    assert.deepEqual(
      stub.requests,
      ["https://api.anitabi.cn/bangumi/2461/points/detail?haveImage=true"],
    );
  });

  void it("serves the lite operation, signed, end to end", async () => {
    const answer = await request("/anitabi/lite/10380", true);
    assert.equal(answer.status, 200);
    assert.equal(answer.marker, "relayed-upstream");
    assert.match(answer.body, /"pointsLength":1/);
    assert.deepEqual(stub.requests, [
      "https://api.anitabi.cn/bangumi/2461/points/detail?haveImage=true",
      "https://api.anitabi.cn/bangumi/10380/lite",
    ]);
  });

  void it("refuses an unsigned request without touching the upstream", async () => {
    const answer = await request("/anitabi/lite/2461", false);
    assert.equal(answer.status, 401);
    assert.equal(answer.marker, "refused-here");
    assert.equal(answer.refusal, "auth");
    assert.equal(stub.requests.length, 2, "the refusal must not have reached the stub");
  });
});

/**
 * The service reaches ONE URL, built from its own capture. A `Location` header
 * is the upstream naming a second destination this repository never reviewed,
 * and global `fetch` follows redirects by default — so the hop has to be
 * refused, and only the real transport can show that it is.
 */
void describe("the redirect the upstream may not send us through", () => {
  const nowSeconds = () => 1_700_000_000;
  const path = "/anitabi/lite/2461";
  let service: { server: Server; port: number };
  let stub: StubUpstream;

  before(async () => {
    stub = await startStubUpstream();
    service = await startEgressServer({
      env: { INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: "100" },
      port: 0,
      nowSeconds,
      upstreamFetch: stub.shim,
    });
  });

  after(() => {
    service.server.close();
    stub.server.close();
  });

  void it("is refused, and the second destination is never contacted", async () => {
    const second = await startSecondDestination();
    try {
      stub.answerWithRedirect(second.url);
      const answer = await ask(service.port, path, signedHeaders(path, nowSeconds()));
      assert.equal(answer.status, 504, "a redirect the service may not follow answers as ours, not as relayed");
      assert.equal(answer.marker, "refused-here");
      assert.equal(answer.refusal, "upstream-timeout");
      assert.deepEqual(second.contacted, [], "the redirect target must never be contacted");
    } finally {
      stub.answerWithRedirect(null);
      second.server.close();
    }
  });
});
