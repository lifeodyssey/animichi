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
