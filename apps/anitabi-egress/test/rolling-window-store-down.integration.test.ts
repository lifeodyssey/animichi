import crypto from "node:crypto";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { StartedTestContainer } from "testcontainers";
import { ceilingStoreFailureLogger } from "../src/ceiling-store-log.ts";
import { startEgressServer } from "../src/start-egress-server.ts";
import { UpstreamRequestCeiling } from "../src/upstream-ceiling.ts";
import { HOUR, redisCli, startRedis, storeOn } from "./ceiling-over-redis.ts";

/**
 * SUT: the ceiling when its real store cannot answer. Failing closed is the
 * whole promise (#1810): a script the store cannot run, and a store that has
 * stopped, each end as the ceiling's own refusal, marked as ours, with the
 * store's reason on the operator's line, and nothing reaches the upstream. The
 * unit suites pin the same refusals over a socket the test owns; this one makes
 * a real Redis refuse.
 *
 * The cases run in order on one container, and the last one stops it.
 */

const KEY = crypto.randomBytes(48).toString("base64");
const PATH = "/anitabi/lite/2461";

/** The window's key, which a case below fills with something that is not a window. */
const WINDOW_KEY = "anitabi-egress:upstream-requests:rolling";

/** Signed request headers for the one path this suite asks for, at the hour the service's clock reads. */
function signedHeaders(): Record<string, string> {
  const signature = crypto.createHmac("sha256", KEY).update(`${String(HOUR)}\n${PATH}`).digest("hex");
  return { "x-egress-timestamp": String(HOUR), "x-egress-signature": signature };
}

void describe("a real store that cannot answer", () => {
  let container: StartedTestContainer;

  before(async () => {
    container = await startRedis();
  });

  void it("refuses when the store cannot run the window, and says why on the operator's line", async () => {
    await redisCli(container, "SET", WINDOW_KEY, "not-a-window");
    const lines: string[] = [];
    const reporter = ceilingStoreFailureLogger((line) => { lines.push(line); });
    const ceiling = new UpstreamRequestCeiling(5, storeOn(container), reporter, () => HOUR);
    assert.equal(await ceiling.tryAcquire(), "store-unavailable");
    const line = JSON.parse(lines.join("")) as { code: string; message: string };
    assert.equal(line.code, "decision");
    assert.match(line.message, /WRONGTYPE/, "the store's own words must reach the operator");
  });

  void it("refuses here, marked as the ceiling's, once the store has stopped, and never reaches the upstream", async () => {
    const upstream: string[] = [];
    const service = await startEgressServer({
      env: { INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: "100" },
      port: 0,
      nowSeconds: () => HOUR,
      upstreamFetch: (url) => {
        upstream.push(url);
        return Promise.resolve(new Response('{"points":[]}', { status: 200 }));
      },
      ceilingStore: storeOn(container),
      logSink: () => undefined,
    });
    await container.stop();
    try {
      const res = await fetch(`http://127.0.0.1:${String(service.port)}${PATH}`, { headers: signedHeaders() });
      assert.equal(res.status, 429);
      assert.equal(res.headers.get("x-egress-refusal"), "ceiling");
      assert.match(await res.text(), /ceiling-store-unavailable/);
      assert.deepEqual(upstream, [], "a service that cannot count must not relay");
    } finally {
      service.server.close();
    }
  });
});
