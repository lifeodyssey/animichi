import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readEgressConfig, readListenPort } from "../src/egress-config.ts";

/**
 * Fail closed (#1792): a service without its key or its ceiling refuses
 * everything, and the composition root must be able to tell. The canonical
 * ceiling value lives in one place — fly.toml's [env], beside the comment
 * that records it as the agreement given to the upstream — and the service
 * reads it from the environment at boot.
 */

const FULL_ENV = {
  INGEST_SIGNING_KEY: "current-key-value-from-fly-secrets",
  UPSTREAM_REQUEST_CEILING_PER_HOUR: "100",
};

void describe("readEgressConfig", () => {
  void it("reads the current key and the ceiling", () => {
    const config = readEgressConfig(FULL_ENV);
    assert.deepEqual(config, {
      currentKey: "current-key-value-from-fly-secrets",
      previousKey: null,
      ceilingPerHour: 100,
    });
  });

  void it("reads an optional previous key for the rotation window", () => {
    const config = readEgressConfig({ ...FULL_ENV, INGEST_SIGNING_KEY_PREVIOUS: "previous-key-value" });
    assert.equal(config?.previousKey, "previous-key-value");
  });

  void it("treats a blank previous key as no previous key", () => {
    const config = readEgressConfig({ ...FULL_ENV, INGEST_SIGNING_KEY_PREVIOUS: "" });
    assert.equal(config?.previousKey, null);
  });

  void it("refuses everything when the key is missing", () => {
    assert.equal(readEgressConfig({ UPSTREAM_REQUEST_CEILING_PER_HOUR: "100" }), null);
  });

  void it("refuses everything when the key is blank", () => {
    assert.equal(readEgressConfig({ ...FULL_ENV, INGEST_SIGNING_KEY: "" }), null);
  });

  void it("refuses everything when the ceiling is missing", () => {
    assert.equal(readEgressConfig({ INGEST_SIGNING_KEY: "k" }), null);
  });

  void it("refuses a ceiling that is not a positive integer", () => {
    for (const ceiling of ["0", "-5", "10.5", "1e3", "abc", ""]) {
      assert.equal(
        readEgressConfig({ INGEST_SIGNING_KEY: "k", UPSTREAM_REQUEST_CEILING_PER_HOUR: ceiling }),
        null,
        `ceiling ${JSON.stringify(ceiling)} must fail closed`,
      );
    }
  });
});

/** The ceiling is a promise to the upstream: a value it cannot exhaust is not a ceiling. */
void describe("readEgressConfig — the ceiling the service can actually enforce", () => {
  void it("refuses a ceiling that would overflow rather than start with an unenforceable limit", () => {
    // `Number("9".repeat(30))` is Infinity, and an infinite ceiling is never
    // exhausted — the promise to the upstream would be ungated rather than
    // generous. Every one of these must fail closed at boot instead.
    const unenforceable = ["9".repeat(30), "1" + "0".repeat(309), "Infinity", "NaN", "-5", "10.5", ""];
    for (const ceiling of unenforceable) {
      const config = readEgressConfig({ INGEST_SIGNING_KEY: "k", UPSTREAM_REQUEST_CEILING_PER_HOUR: ceiling });
      assert.ok(config === null || Number.isFinite(config.ceilingPerHour),
        `ceiling ${JSON.stringify(ceiling)} must never configure an unenforceable limit`);
      assert.equal(config, null, `ceiling ${JSON.stringify(ceiling)} must fail closed`);
    }
  });

  void it("refuses a ceiling above one request per second of its own window", () => {
    // The window is an hour; a ceiling above one request per second is not a
    // rate limit at all. The bound is the window's own arithmetic, not a
    // second opinion about the agreed number.
    assert.equal(
      readEgressConfig({ INGEST_SIGNING_KEY: "k", UPSTREAM_REQUEST_CEILING_PER_HOUR: String(60 * 60) })?.ceilingPerHour,
      3600,
      "the largest enforceable ceiling is one request per second of the window",
    );
    assert.equal(
      readEgressConfig({ INGEST_SIGNING_KEY: "k", UPSTREAM_REQUEST_CEILING_PER_HOUR: String(60 * 60 + 1) }),
      null,
      "a ceiling above one request per second is an absence of a limit, not a large one",
    );
  });
});

void describe("readListenPort", () => {
  void it("defaults to 8080", () => {
    assert.equal(readListenPort({}), 8080);
  });

  void it("reads PORT when it is a valid port number", () => {
    assert.equal(readListenPort({ PORT: "9090" }), 9090);
  });

  void it("falls back to 8080 on a garbage PORT", () => {
    assert.equal(readListenPort({ PORT: "http" }), 8080);
  });
});
