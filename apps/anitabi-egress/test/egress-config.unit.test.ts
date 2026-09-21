import crypto from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readCeilingStoreConfig, readEgressConfig, readListenPort } from "../src/egress-config.ts";

/**
 * Fail closed (#1792): a service without its key or its ceiling refuses
 * everything, and the composition root must be able to tell. The canonical
 * ceiling value lives in one place — fly.toml's [env], beside the comment
 * that records it as the agreement given to the upstream — and the service
 * reads it from the environment at boot.
 */

/** A key in the one documented form, `openssl rand -base64 48`, generated rather than written. */
const KEY = crypto.randomBytes(48).toString("base64");

/** Another key in that form, for the rotation window. */
const PREVIOUS_KEY = crypto.randomBytes(48).toString("base64");

/** The shortest value the documented generator cannot produce: 63 characters is not 48 bytes. */
const SHORT_KEY = "a".repeat(63);

const FULL_ENV = {
  INGEST_SIGNING_KEY: KEY,
  UPSTREAM_REQUEST_CEILING_PER_HOUR: "100",
};

void describe("readEgressConfig", () => {
  void it("reads the current key and the ceiling", () => {
    const config = readEgressConfig(FULL_ENV);
    assert.deepEqual(config, { currentKey: KEY, previousKey: null, ceilingPerHour: 100 });
  });

  void it("reads an optional previous key for the rotation window", () => {
    const config = readEgressConfig({ ...FULL_ENV, INGEST_SIGNING_KEY_PREVIOUS: PREVIOUS_KEY });
    assert.equal(config?.previousKey, PREVIOUS_KEY);
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
    assert.equal(readEgressConfig({ INGEST_SIGNING_KEY: KEY }), null);
  });

  void it("refuses a ceiling that is not a positive integer", () => {
    for (const ceiling of ["0", "-5", "10.5", "1e3", "abc", ""]) {
      assert.equal(
        readEgressConfig({ INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: ceiling }),
        null,
        `ceiling ${JSON.stringify(ceiling)} must fail closed`,
      );
    }
  });
});

/**
 * The one documented way to make a key is `openssl rand -base64 48`, and that
 * writes 48 bytes as exactly 64 base64 characters with no padding. A value
 * outside that form is refused at boot instead of signed with: the service
 * would otherwise run on a key the caller cannot be holding, and a short,
 * blank-looking or pasted-from-prose value is a key an attacker can guess
 * (CWE-326). The check is the SHAPE, not an estimate of randomness — no
 * inspection can tell a well-formed random key from 64 characters of `a`.
 */
void describe("readEgressConfig — the signing key must be the documented shape", () => {
  void it("accepts the documented generator's output", () => {
    assert.equal(readEgressConfig(FULL_ENV)?.currentKey, KEY);
  });

  void it("refuses every value the documented generator cannot produce", () => {
    const unusable = [
      " ",
      "k",
      "secret",
      SHORT_KEY,
      `${SHORT_KEY}aa`,
      "-".repeat(64),
      " ".repeat(64),
      `${KEY}\n`,
      ` ${KEY}`,
      `${KEY}=`,
      "current-key-value-from-fly-secrets",
    ];
    for (const key of unusable) {
      assert.equal(
        readEgressConfig({ ...FULL_ENV, INGEST_SIGNING_KEY: key }),
        null,
        `key ${JSON.stringify(key)} must fail closed rather than be signed with`,
      );
    }
  });

  void it("accepts any 64-character value — the claim is the documented shape, not strength", () => {
    assert.equal(readEgressConfig({ ...FULL_ENV, INGEST_SIGNING_KEY: "a".repeat(64) })?.currentKey, "a".repeat(64));
  });

  void it("treats a previous key outside that shape as no previous key", () => {
    const invalid = readEgressConfig({ ...FULL_ENV, INGEST_SIGNING_KEY_PREVIOUS: "previous-key-value" });
    assert.equal(invalid?.previousKey, null, "an unusable previous key is absent, not accepted as one");
    const valid = readEgressConfig({ ...FULL_ENV, INGEST_SIGNING_KEY_PREVIOUS: PREVIOUS_KEY });
    assert.equal(valid?.previousKey, PREVIOUS_KEY, "a usable previous key still opens the rotation window");
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
      const config = readEgressConfig({ INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: ceiling });
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
      readEgressConfig({ INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: String(60 * 60) })?.ceilingPerHour,
      3600,
      "the largest enforceable ceiling is one request per second of the window",
    );
    assert.equal(
      readEgressConfig({ INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: String(60 * 60 + 1) }),
      null,
      "a ceiling above one request per second is an absence of a limit, not a large one",
    );
  });
});

/**
 * The ceiling's counter lives outside this process (#1810), and since #1824 it
 * is the Redis `fly redis create` provisions: the Private URL that command's
 * status prints, which is a `redis://` address carrying the store's own
 * password. The service has to be told where it is, and a value that is not
 * that address is refused at boot rather than dialed.
 *
 * It is a SEPARATE read from the key and the ceiling on purpose: the
 * composition root is what pairs them, and a service holding a key and a limit
 * but no store still refuses everything.
 */
void describe("readCeilingStoreConfig", () => {
  /** A Private URL in the shape `fly redis status` prints: the password is inside the address. */
  const STORE_URL = `redis://default:${crypto.randomBytes(24).toString("hex")}@fly-animichi-test.upstash.io:6379`;

  void it("reads the store's address", () => {
    assert.deepEqual(readCeilingStoreConfig({ CEILING_STORE_URL: STORE_URL }), { url: STORE_URL });
  });

  void it("reads an address with no credential in it — the store is what refuses an unauthenticated client", () => {
    const bare = "redis://fly-animichi-test.upstash.io:6379";
    assert.deepEqual(readCeilingStoreConfig({ CEILING_STORE_URL: bare }), { url: bare });
  });

  void it("is a separate read from the signing key and the ceiling", () => {
    assert.equal(readEgressConfig(FULL_ENV)?.currentKey, KEY, "the service's own configuration is unchanged");
    assert.equal(
      readCeilingStoreConfig(FULL_ENV),
      null,
      "a service with a key and a limit but no store has no ceiling, and the composition root refuses everything",
    );
  });
});

/**
 * What fails closed at boot. The checks are the failures a paste actually
 * produces: the `https://` REST endpoint #1810 used — reading it as a Redis
 * host would point the service at a destination that is not its store — a URL
 * the service has no business dialing, a value with no host in it, and a value
 * still carrying the line break it was copied with. A store the service cannot
 * name is a ceiling it cannot count, and this service does not run uncounted.
 */
void describe("readCeilingStoreConfig — the values that refuse everything at boot", () => {
  void it("refuses the https REST endpoint this replaced, rather than reading it as a Redis host", () => {
    assert.equal(
      readCeilingStoreConfig({ CEILING_STORE_URL: "https://store.test" }),
      null,
      "a leftover CEILING_STORE_URL from #1810 must fail closed at boot, not be dialed as if it were Redis",
    );
  });

  void it("refuses everywhere the service is not told to dial", () => {
    const undialable = [
      "http://store.test",
      "rediss://store.test:6379",
      "ws://store.test",
      "redis://",
      "fly-animichi-test.upstash.io:6379",
      "",
    ];
    for (const url of undialable) {
      assert.equal(
        readCeilingStoreConfig({ CEILING_STORE_URL: url }),
        null,
        `${JSON.stringify(url)} is not the Private URL Fly prints, and the service dials nothing else`,
      );
    }
  });

  void it("refuses when the store's address is missing", () => {
    assert.equal(readCeilingStoreConfig({}), null);
  });

  void it("refuses an address carrying the line break it was copied with", () => {
    const pasted = `redis://default:${crypto.randomBytes(24).toString("hex")}@fly-animichi-test.upstash.io:6379\n`;
    assert.equal(
      readCeilingStoreConfig({ CEILING_STORE_URL: pasted }),
      null,
      "a value with whitespace in it is a paste that lost or gained a line, not an address to dial",
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
