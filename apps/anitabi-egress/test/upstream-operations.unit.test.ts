import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANITABI_API_SURFACE,
  ANITABI_UPSTREAM_BASE,
  ANITABI_UPSTREAM_ORIGIN,
  UPSTREAM_USER_AGENT,
  resolveOperation,
  upstreamUrlFor,
  type EgressOperation,
} from "../src/upstream-operations.ts";

/**
 * The permitted surface of the upstream's API document — `anitabi-api-surface.json`
 * — is this service's primary control (#1792). The capture is the only place a
 * route or an upstream path can come from, so freezing the capture freezes the
 * service: widening it is a reviewed edit to the JSON AND to this file, never a
 * quiet one to a constant.
 *
 * The URL itself is built from the capture's templates, so what these tests
 * prove is that the builder adds nothing to them and that no input can reach a
 * destination the capture does not name.
 */

void describe("the permitted surface is exactly the two operations the document describes", () => {
  void it("declares the two operations, and no third", () => {
    assert.deepEqual(
      ANITABI_API_SURFACE.operations.map((operation) => operation.name),
      ["points", "lite"],
    );
  });

  void it("maps them onto the two upstream paths the document describes", () => {
    assert.deepEqual(
      ANITABI_API_SURFACE.operations.map((operation) => operation.upstreamPathTemplate),
      ["/bangumi/{bangumiId}/points/detail", "/bangumi/{bangumiId}/lite"],
    );
  });

  void it("serves them on the two documented routes", () => {
    assert.deepEqual(
      ANITABI_API_SURFACE.operations.map((operation) => operation.egressPathTemplate),
      ["/anitabi/points/{bangumiId}", "/anitabi/lite/{bangumiId}"],
    );
  });

  void it("permits one query parameter, on one operation, with one value", () => {
    assert.deepEqual(
      ANITABI_API_SURFACE.operations.map((operation) => operation.query),
      [[{ name: "haveImage", value: "true" }], []],
    );
  });

  void it("records the allowed image plans, and the full-resolution case", () => {
    assert.deepEqual(ANITABI_API_SURFACE.imagePlans, {
      queryParameter: "plan",
      values: ["h160", "h360"],
      fullResolution: "omit the plan parameter",
    });
  });

  void it("records the forbidden main domain, which is not either permitted origin", () => {
    assert.equal(ANITABI_API_SURFACE.forbiddenMainOrigin, "https://anitabi.cn");
    assert.notEqual(ANITABI_API_SURFACE.forbiddenMainOrigin, ANITABI_API_SURFACE.apiOrigin);
    assert.notEqual(ANITABI_API_SURFACE.forbiddenMainOrigin, ANITABI_API_SURFACE.imageOrigin);
  });
});

void describe("resolveOperation — the only two shapes", () => {
  void it("resolves /anitabi/points/{id} to the points operation", () => {
    assert.equal(operationName("/anitabi/points/2461"), "points");
    assert.equal(resolveOperation("/anitabi/points/2461")?.bangumiId, "2461");
  });

  void it("resolves /anitabi/lite/{id} to the lite operation", () => {
    assert.equal(operationName("/anitabi/lite/10380"), "lite");
    assert.equal(resolveOperation("/anitabi/lite/10380")?.bangumiId, "10380");
  });

  void it("resolves nothing else", () => {
    const refusals = [
      "",
      "/",
      "/anitabi",
      "/anitabi/points",
      "/anitabi/points/",
      "/anitabi/points/2461/extra",
      "/anitabi/lite/2461/extra",
      "/anitabi/points/2461/",
      "/anitabi/other/2461",
      "/anitabi/points/abc",
      "/anitabi/points/2461abc",
      "/anitabi/points/-1",
      "/anitabi/points/0",
      "/anitabi/points/007",
      "/anitabi/points/../2461",
      "/anitabi/points/%2e%2e/2461",
      "/anitabi/points/24%361",
      "/ANITABI/points/2461",
      "/anitabi/POINTS/2461",
      "//anitabi/points/2461",
      "/api.anitabi.cn/bangumi/2461/lite",
      "/anitabi/points/2461?to=evil.test",
      "https://evil.test/anitabi/points/2461",
      "/bangumi/2461/points/detail",
      "/forward?url=https://evil.test/",
    ];
    for (const path of refusals) {
      assert.equal(resolveOperation(path), null, `expected ${JSON.stringify(path)} to resolve to nothing`);
    }
  });
});

void describe("upstreamUrlFor — the URL the service itself builds", () => {
  void it("builds the points/detail URL with the capture's one query parameter", () => {
    assert.equal(
      upstreamUrlFor(operation("/anitabi/points/2461")),
      "https://api.anitabi.cn/bangumi/2461/points/detail?haveImage=true",
    );
  });

  void it("builds the lite URL, with no query at all", () => {
    assert.equal(
      upstreamUrlFor(operation("/anitabi/lite/10380")),
      "https://api.anitabi.cn/bangumi/10380/lite",
    );
  });

  void it("builds every URL under the one anitabi upstream base", () => {
    for (const path of ["/anitabi/points/2461", "/anitabi/lite/2461"]) {
      const url = upstreamUrlFor(operation(path));
      assert.ok(url.startsWith(`${ANITABI_UPSTREAM_BASE}/`), `${url} must sit under ${ANITABI_UPSTREAM_BASE}`);
    }
  });

  void it("never builds a URL on the forbidden main domain", () => {
    assert.ok(!ANITABI_API_SURFACE.forbiddenMainOrigin.startsWith(ANITABI_UPSTREAM_ORIGIN));
    for (const path of ["/anitabi/points/2461", "/anitabi/lite/2461"]) {
      assert.ok(!upstreamUrlFor(operation(path)).startsWith(ANITABI_API_SURFACE.forbiddenMainOrigin));
    }
  });
});

void describe("the upstream identity", () => {
  void it("is the same User-Agent the catalog ingest path uses", () => {
    assert.equal(UPSTREAM_USER_AGENT, "Animichi/1.0 (https://github.com/lifeodyssey/animichi)");
    assert.equal(UPSTREAM_USER_AGENT, ANITABI_API_SURFACE.userAgent);
  });
});

function operation(path: string): EgressOperation {
  const resolved = resolveOperation(path);
  if (resolved === null) throw new Error(`${path} must resolve to an operation`);
  return resolved;
}

function operationName(path: string): string {
  return operation(path).spec.name;
}
