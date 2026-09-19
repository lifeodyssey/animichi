import crypto from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleEgressRequest, type EgressDeps, type UpstreamResponseLike } from "../src/egress-service.ts";
import type { EgressConfig } from "../src/egress-config.ts";

/**
 * The request handler contract (#1792): exactly two operations; a verified
 * signature before anything else; a ceiling the caller cannot argue with;
 * our refusals unmistakably ours and upstream answers unmistakably relayed;
 * and no input, anywhere, that can name another destination.
 */

const KEY = crypto.randomBytes(48).toString("base64");
const CONFIG: EgressConfig = { currentKey: KEY, previousKey: null, ceilingPerHour: 100 };

function nowSeconds(): number {
  return 1_700_000_000;
}

/** Sign the scheme the service verifies: `${timestamp}\n${path}`. */
function sign(path: string, at = nowSeconds(), key = KEY): string {
  return crypto.createHmac("sha256", key).update(`${String(at)}\n${path}`).digest("hex");
}

function signedRequest(path: string, key = KEY, at = nowSeconds()): Request {
  return new Request(`https://egress.test${path}`, {
    headers: { "x-egress-timestamp": String(at), "x-egress-signature": sign(path, at, key) },
  });
}

function unsignedRequest(path: string): Request {
  return new Request(`https://egress.test${path}`);
}

/** An upstream stub that records every URL it is asked for, and how each request was allowed to redirect. */
function recordingUpstream(status = 200, body = '{"ok":true}'): {
  urls: string[];
  userAgents: (string | undefined)[];
  redirects: (string | undefined)[];
  fetch: (url: string, init?: { headers?: Record<string, string>; redirect?: string }) => Promise<UpstreamResponseLike>;
} {
  const urls: string[] = [];
  const userAgents: (string | undefined)[] = [];
  const redirects: (string | undefined)[] = [];
  return {
    urls,
    userAgents,
    redirects,
    fetch: (url: string, init?: { headers?: Record<string, string>; redirect?: string }) => {
      urls.push(url);
      userAgents.push(init?.headers?.["user-agent"]);
      redirects.push(init?.redirect);
      return Promise.resolve(new Response(body, { status, headers: { "content-type": "application/json" } }));
    },
  };
}

function deps(upstream: (url: string, init?: { headers?: Record<string, string> }) => Promise<UpstreamResponseLike>, overrides: Partial<EgressDeps> = {}): EgressDeps {
  return {
    config: CONFIG,
    ceiling: { tryAcquire: () => true },
    upstreamFetch: upstream,
    nowSeconds,
    ...overrides,
  };
}

/** Inputs that must never widen the service's destination. */
const ADVERSARIAL_PATHS = [
  "/anitabi/points/2461",
  "/anitabi/lite/10380",
  "/anitabi/points/2461?host=evil.test&url=https://evil.test/",
  "/anitabi/points/../bangumi/2461/points/detail",
  "/anitabi/points/%2e%2e/2461",
  "/forward?to=https://evil.test/",
  "/proxy?url=https://evil.test/x",
  "//evil.test/anitabi/lite/1",
  "https://evil.test/anitabi/lite/1",
  "/anitabi/lite/1#https://evil.test",
  "/api.anitabi.cn/bangumi/1/lite",
  "/bangumi/1/lite",
  "",
  "/",
  "/anitabi/points/99999999999999999999",
  "/anitabi/" + "1".repeat(500),
  "/" + "a".repeat(2000),
];

/** The only upstream URLs that may ever be requested, in full. */
const UPSTREAM_URL_PATTERN =
  /^https:\/\/api\.anitabi\.cn\/bangumi\/(\d+)\/(points\/detail\?haveImage=true|lite)$/;

void describe("no input can name another destination", () => {
  void it("every request, however crafted, can only ever fetch the two anitabi URLs", async () => {
    const upstream = recordingUpstream();
    for (const path of ADVERSARIAL_PATHS) {
      const target = `https://egress.test${path}`;
      await handleEgressRequest(new Request(target, { headers: unsignedHeaders(target) }), deps(upstream.fetch));
    }
    for (const url of upstream.urls) {
      assert.match(url, UPSTREAM_URL_PATTERN, `the service requested ${url} — no input may name another destination`);
    }
  });

  void it("never lets a non-GET method through to the upstream", async () => {
    const upstream = recordingUpstream();
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
      const res = await handleEgressRequest(
        new Request("https://egress.test/anitabi/lite/2461", {
          method,
          headers: { "x-egress-timestamp": String(nowSeconds()), "x-egress-signature": sign("/anitabi/lite/2461") },
        }),
        deps(upstream.fetch),
      );
      assert.equal(res.status, 405);
      assert.equal(upstream.urls.length, 0, `${method} must not reach the upstream`);
    }
  });

  /** Sign an absolute target the way a client would: over its pathname. */
  function unsignedHeaders(target: string): Record<string, string> {
    const path = new URL(target).pathname;
    return { "x-egress-timestamp": String(nowSeconds()), "x-egress-signature": sign(path) };
  }
});

void describe("relayed upstream answers are marked as the upstream's", () => {
  void it("relays a 200 body and status under the relayed marker", async () => {
    const upstream = recordingUpstream(200, '{"points":[]}');
    const res = await handleEgressRequest(signedRequest("/anitabi/lite/2461"), deps(upstream.fetch));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '{"points":[]}');
    assert.equal(res.headers.get("x-egress-response"), "relayed-upstream");
    assert.equal(res.headers.get("x-egress-refusal"), null);
  });

  void it("relays an upstream 403 as the upstream's refusal, not ours", async () => {
    const upstream = recordingUpstream(403, "forbidden");
    const res = await handleEgressRequest(signedRequest("/anitabi/points/2461"), deps(upstream.fetch));
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("x-egress-response"), "relayed-upstream");
    assert.notEqual(res.headers.get("x-egress-refusal"), "ceiling");
  });

  void it("relays a transient upstream 429 with its Retry-After so the caller can honor it", async () => {
    const urls: string[] = [];
    const fetch = (url: string) => {
      urls.push(url);
      return Promise.resolve(
        new Response(null, { status: 429, headers: { "retry-after": "30" } }),
      );
    };
    const res = await handleEgressRequest(signedRequest("/anitabi/lite/2461"), deps(fetch));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "30");
    assert.equal(res.headers.get("x-egress-response"), "relayed-upstream");
  });

  void it("sends the one Animichi User-Agent on every upstream request", async () => {
    const upstream = recordingUpstream();
    await handleEgressRequest(signedRequest("/anitabi/lite/2461"), deps(upstream.fetch));
    await handleEgressRequest(signedRequest("/anitabi/points/2461"), deps(upstream.fetch));
    assert.deepEqual(
      upstream.userAgents,
      [
        "Animichi/1.0 (https://github.com/lifeodyssey/animichi)",
        "Animichi/1.0 (https://github.com/lifeodyssey/animichi)",
      ],
    );
  });
});

void describe("the relay never follows a redirect off the one upstream URL", () => {
  void it("tells the transport to refuse a redirect rather than follow it", async () => {
    // Global `fetch` follows a `Location` by default, which would turn an
    // allowlisted host into a second destination the service never reviewed.
    // The policy travels with the request, so the production transport — the
    // unwrapped global fetch — cannot follow one; the integration suite proves
    // it against a real loopback redirect.
    const upstream = recordingUpstream();
    await handleEgressRequest(signedRequest("/anitabi/lite/2461"), deps(upstream.fetch));
    assert.deepEqual(upstream.redirects, ["error"]);
  });

  void it("answers a refused redirect as our marked refusal, not silence", async () => {
    const facts = await refusalFacts(signedRequest("/anitabi/lite/2461"), {
      upstreamFetch: () => Promise.reject(new TypeError("unexpected redirect")),
    });
    assert.equal(facts.status, 504);
    assert.equal(facts.marker, "refused-here");
    assert.equal(facts.reason, "upstream-timeout");
  });
});

/** The three refusal facts a caller reads off one response. */
async function refusalFacts(request: Request, overrides: Partial<EgressDeps> = {}): Promise<{
  status: number;
  marker: string | null;
  reason: string | null;
  upstreamCalls: number;
}> {
  const upstream = recordingUpstream();
  const res = await handleEgressRequest(request, deps(upstream.fetch, overrides));
  return {
    status: res.status,
    marker: res.headers.get("x-egress-response"),
    reason: res.headers.get("x-egress-refusal"),
    upstreamCalls: upstream.urls.length,
  };
}

void describe("this service's own refusals are marked unmistakably", () => {
  void it("refuses an unsigned request with 401 + refusal marker, and nothing reaches the upstream", async () => {
    const facts = await refusalFacts(unsignedRequest("/anitabi/lite/2461"));
    assert.equal(facts.status, 401);
    assert.equal(facts.marker, "refused-here");
    assert.equal(facts.reason, "auth");
    assert.equal(facts.upstreamCalls, 0);
  });

  void it("refuses a wrong-key signature", async () => {
    const wrongKey = crypto.randomBytes(48).toString("base64");
    const facts = await refusalFacts(signedRequest("/anitabi/lite/2461", wrongKey));
    assert.equal(facts.status, 401);
    assert.equal(facts.reason, "auth");
    assert.equal(facts.upstreamCalls, 0);
  });

  void it("accepts the previous key during rotation", async () => {
    const previous = crypto.randomBytes(48).toString("base64");
    const upstream = recordingUpstream();
    const res = await handleEgressRequest(signedRequest("/anitabi/lite/2461", previous), deps(upstream.fetch, {
      config: { currentKey: KEY, previousKey: previous, ceilingPerHour: 100 },
    }));
    assert.equal(res.status, 200);
    assert.equal(upstream.urls.length, 1);
  });

});

void describe("our ceiling and fail-closed refusals", () => {
  void it("refuses the ceiling as OURS — distinguishable from any upstream answer", async () => {
    const facts = await refusalFacts(signedRequest("/anitabi/lite/2461"), {
      ceiling: { tryAcquire: () => false },
    });
    assert.equal(facts.status, 429);
    assert.equal(facts.marker, "refused-here");
    assert.equal(facts.reason, "ceiling");
    assert.equal(facts.upstreamCalls, 0);
  });

  void it("an unauthenticated request consumes no ceiling budget", async () => {
    const upstream = recordingUpstream();
    let budget = 1;
    const ceiling = { tryAcquire: () => (budget > 0 ? (budget -= 1, true) : false) };
    await handleEgressRequest(unsignedRequest("/anitabi/lite/2461"), deps(upstream.fetch, { ceiling }));
    const res = await handleEgressRequest(signedRequest("/anitabi/lite/2461"), deps(upstream.fetch, { ceiling }));
    assert.equal(res.status, 200, "the refused request must not have spent the ceiling slot");
  });

  void it("refuses an unknown route as ours, and nothing reaches the upstream", async () => {
    const facts = await refusalFacts(signedRequest("/anitabi/other/2461"));
    assert.equal(facts.status, 404);
    assert.equal(facts.marker, "refused-here");
    assert.equal(facts.reason, "no-such-operation");
    assert.equal(facts.upstreamCalls, 0);
  });

  void it("refuses everything when configuration is missing — fail closed", async () => {
    const facts = await refusalFacts(signedRequest("/anitabi/lite/2461"), { config: null });
    assert.equal(facts.status, 503);
    assert.equal(facts.marker, "refused-here");
    assert.equal(facts.reason, "configuration");
    assert.equal(facts.upstreamCalls, 0);
  });
});

void describe("a failed upstream answer is our marked refusal, never silence", () => {
  void it("refuses when the upstream times out or fails to answer at all", async () => {
    const facts = await refusalFacts(signedRequest("/anitabi/lite/2461"), {
      upstreamFetch: () => Promise.reject(new Error("connection reset")),
    });
    assert.equal(facts.status, 504);
    assert.equal(facts.marker, "refused-here");
    assert.equal(facts.reason, "upstream-timeout");
  });

  void it("refuses when the upstream body fails to read AFTER its headers arrived", async () => {
    // Headers arriving is not the answer arriving: a reset or stalled body
    // stream rejects in `arrayBuffer()`. That must land in the same marked
    // refusal, not escape into the detached server promise and leave the
    // caller with no response at all.
    const facts = await refusalFacts(signedRequest("/anitabi/lite/2461"), {
      upstreamFetch: () => Promise.resolve({
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        arrayBuffer: () => Promise.reject(new Error("body stream reset")),
      }),
    });
    assert.equal(facts.status, 504);
    assert.equal(facts.marker, "refused-here");
    assert.equal(facts.reason, "upstream-timeout");
  });
});
