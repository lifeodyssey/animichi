import { describe, expect, it } from "vitest";
import { egressSigningKeyFromEnv } from "../src/ingest/anitabi-egress";
import { fetchAnitabiPoints } from "../src/ingest/sources";
import { stubEgressSigningKey } from "./egress-stub";

/**
 * The caller's half of the signing key's documented form (#1792): the service
 * refuses to start on a key `openssl rand -base64 48` could not have produced
 * (`apps/anitabi-egress/src/egress-config.ts`), and this side resolves the same
 * shape or resolves nothing at all. A value only one side calls a key is a
 * configuration that can produce nothing but refusals — and while the value is
 * short enough to guess, signatures an attacker can forge (CWE-326).
 *
 * The key is generated at run time, never written down: the disclosure
 * contract (`test/repo-config/anitabi-egress-disclosure.test.rb`) refuses a
 * key-shaped literal anywhere in this tree.
 */

/** Values the documented generator cannot produce, in the shapes a pasted key arrives in. */
const NOT_KEYS = [
  "",
  " ",
  "k",
  "secret",
  "a".repeat(63),
  "a".repeat(65),
  `${"a".repeat(64)}\n`,
  "-".repeat(64),
  "current-key-value-from-fly-secrets",
];

describe("the signing key the caller resolves is the documented shape or nothing", () => {
  it("resolves a key the documented generator produces", async () => {
    const key = stubEgressSigningKey();
    await expect(egressSigningKeyFromEnv({ INGEST_SIGNING_KEY: key })).resolves.toBe(key);
  });

  it("resolves a Secrets Store binding holding one the same way", async () => {
    const key = stubEgressSigningKey();
    const binding = { get: () => Promise.resolve(key) };
    await expect(egressSigningKeyFromEnv({ INGEST_SIGNING_KEY: binding })).resolves.toBe(key);
  });

  it("resolves nothing for a value the generator cannot produce", async () => {
    for (const value of NOT_KEYS) {
      await expect(egressSigningKeyFromEnv({ INGEST_SIGNING_KEY: value })).resolves.toBeUndefined();
    }
  });

  it("leaves the anitabi fetchers refusing rather than signing with such a key", async () => {
    const key = await egressSigningKeyFromEnv({ INGEST_SIGNING_KEY: "a".repeat(63) });
    expect(key).toBeUndefined();
    await expect(fetchAnitabiPoints("2461", { egressSigningKey: key })).rejects.toThrow(
      /anitabi egress is not configured/,
    );
  });
});
