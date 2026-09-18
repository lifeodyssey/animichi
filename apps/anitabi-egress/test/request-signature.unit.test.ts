import crypto from "node:crypto";
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  SIGNATURE_WINDOW_SECONDS,
  verifyRequestSignature,
  type SignatureHeaders,
} from "../src/request-signature.ts";

/**
 * The service verifies a signature; it never accepts a token (#1792). The
 * caller signs `${timestamp}\n${path}` with HMAC-SHA256; the key never crosses
 * the wire. These tests build every expected signature independently with
 * node:crypto, and every key in the tree is generated at runtime — the tree
 * carries no key value.
 */

/** Fresh random key: no key value ever lives in this tree. */
function randomKey(): string {
  return crypto.randomBytes(48).toString("base64");
}

/** Sign the message the scheme defines, independently of the code under test. */
function sign(key: string, timestampSeconds: number, path: string): string {
  return crypto.createHmac("sha256", key).update(`${String(timestampSeconds)}\n${path}`).digest("hex");
}

function headersFor(timestampSeconds: number, signature: string): SignatureHeaders {
  return { timestamp: String(timestampSeconds), signature };
}

const PATH = "/anitabi/lite/2461";
const NOW = 1_700_000_000;

void describe("verifyRequestSignature — accepting a correct signature", () => {
  const path = PATH;
  const nowSeconds = NOW;

  void it("accepts a current-key signature inside the window", () => {
    const key = randomKey();
    const verified = verifyRequestSignature(
      { current: key, previous: null },
      headersFor(nowSeconds, sign(key, nowSeconds, path)),
      path,
      nowSeconds,
    );
    assert.equal(verified.ok, true);
  });

  void it("accepts the previous key during a rotation window", () => {
    const current = randomKey();
    const previous = randomKey();
    const verified = verifyRequestSignature(
      { current, previous },
      headersFor(nowSeconds, sign(previous, nowSeconds, path)),
      path,
      nowSeconds,
    );
    assert.equal(verified.ok, true);
  });

});

void describe("verifyRequestSignature — rotation and tampering", () => {
  const path = PATH;
  const nowSeconds = NOW;

  void it("refuses a signature made with a third key", () => {
    const current = randomKey();
    const previous = randomKey();
    const third = randomKey();
    const verified = verifyRequestSignature(
      { current, previous },
      headersFor(nowSeconds, sign(third, nowSeconds, path)),
      path,
      nowSeconds,
    );
    assert.equal(verified.ok, false);
  });

  void it("refuses a signature computed over a different path", () => {
    const key = randomKey();
    const verified = verifyRequestSignature(
      { current: key, previous: null },
      headersFor(nowSeconds, sign(key, nowSeconds, "/anitabi/points/2461")),
      path,
      nowSeconds,
    );
    assert.equal(verified.ok, false);
  });

});

/**
 * Verify once against `key`. The malformed-header cases sign with the SAME key
 * they verify with: otherwise a key mismatch fails them and a regression in
 * header parsing hides behind it — the case would stay green while testing
 * nothing.
 */
function verifyOne(key: string, headers: SignatureHeaders, path: string, at = NOW): { ok: boolean } {
  return verifyRequestSignature({ current: key, previous: null }, headers, path, at);
}

void describe("verifyRequestSignature — the window and malformed headers", () => {
  const path = PATH;
  const nowSeconds = NOW;

  void it("refuses a timestamp older than the window", () => {
    const key = randomKey();
    const stale = nowSeconds - SIGNATURE_WINDOW_SECONDS - 1;
    const verified = verifyRequestSignature(
      { current: key, previous: null },
      headersFor(stale, sign(key, stale, path)),
      path,
      nowSeconds,
    );
    assert.equal(verified.ok, false);
  });

  void it("refuses a timestamp in the future beyond the window", () => {
    const key = randomKey();
    const future = nowSeconds + SIGNATURE_WINDOW_SECONDS + 1;
    const verified = verifyRequestSignature(
      { current: key, previous: null },
      headersFor(future, sign(key, future, path)),
      path,
      nowSeconds,
    );
    assert.equal(verified.ok, false);
  });

})

void describe("verifyRequestSignature — malformed headers", () => {
  const path = PATH;
  const nowSeconds = NOW;

  void it("refuses a missing, empty, or non-numeric timestamp", () => {
    const key = randomKey();
    for (const timestamp of [undefined, "", "now", "1e9", "1700000000.5", " 1700000000"]) {
      const headers = { timestamp, signature: sign(key, nowSeconds, path) };
      const verified = verifyOne(key, headers, path, nowSeconds);
      assert.equal(verified.ok, false, `timestamp ${String(timestamp)} must not verify`);
    }
  });

  void it("refuses a missing or malformed signature", () => {
    const key = randomKey();
    for (const signature of [undefined, "", "deadbeef", "g".repeat(64)] as (string | undefined)[]) {
      const verified = verifyOne(key, { timestamp: String(nowSeconds), signature }, path, nowSeconds);
      assert.equal(verified.ok, false, `signature ${String(signature)} must not verify`);
    }
  });

  void it("compares in constant time, through crypto.timingSafeEqual", () => {
    const key = randomKey();
    const headers = headersFor(nowSeconds, sign(key, nowSeconds, path));
    // The default-import surface is what the implementation must call
    // through, so the property lookup stays interceptable.
    const compare = mock.method(crypto, "timingSafeEqual");
    try {
      const verified = verifyRequestSignature({ current: key, previous: null }, headers, path, nowSeconds);
      assert.equal(verified.ok, true);
      assert.ok(compare.mock.calls.length >= 1, "the signature comparison must go through crypto.timingSafeEqual");
    } finally {
      compare.mock.restore();
    }
  });
});
