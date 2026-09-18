import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareEgressAddress,
  ipv4FromFlyIpsJson,
  readExpectedAddress,
} from "../src/egress-address-guard.ts";

/**
 * The guard that matters most (#1792): the quiet failure is not the service
 * dying, it is the egress address changing so the upstream's allowlist stops
 * matching and ingest stops succeeding. The address itself is NOT in this
 * public tree — the expected value is supplied at run time (operator
 * environment / CI secret), and these tests use RFC 5737 documentation
 * addresses (192.0.2.0/24), which cannot be a real allowlisted address.
 */

void describe("readExpectedAddress", () => {
  void it("reads the expected address from the environment, held outside the tree", () => {
    assert.equal(readExpectedAddress({ ANITABI_EGRESS_EXPECTED_IPV4: "192.0.2.10" }), "192.0.2.10");
  });

  void it("reports the guard as unconfigured when the environment carries nothing", () => {
    assert.equal(readExpectedAddress({}), null);
    assert.equal(readExpectedAddress({ ANITABI_EGRESS_EXPECTED_IPV4: "" }), null);
  });
});

void describe("ipv4FromFlyIpsJson", () => {
  void it("reads the IPv4 address out of `fly ips list --json` output", () => {
    const flyJson = JSON.stringify([
      { id: "v6-id", address: "2001:db8::1", type: "v6", region: null },
      { id: "v4-id", address: "192.0.2.10", type: "v4", region: null },
    ]);
    assert.equal(ipv4FromFlyIpsJson(flyJson), "192.0.2.10");
  });

  void it("returns null on output that carries no IPv4", () => {
    assert.equal(ipv4FromFlyIpsJson(JSON.stringify([{ address: "2001:db8::1", type: "v6" }])), null);
    assert.equal(ipv4FromFlyIpsJson("not json"), null);
    assert.equal(ipv4FromFlyIpsJson("[]"), null);
  });
});

void describe("compareEgressAddress", () => {
  void it("passes when the live address matches the expected one", () => {
    const verdict = compareEgressAddress("192.0.2.10", "192.0.2.10");
    assert.equal(verdict.ok, true);
  });

  void it("fails when the address changed — the allowlist no longer matches", () => {
    const verdict = compareEgressAddress("192.0.2.10", "192.0.2.11");
    assert.equal(verdict.ok, false);
    assert.match(verdict.detail, /allowlist/i);
  });

  void it("fails closed when the guard is unconfigured", () => {
    const verdict = compareEgressAddress(null, "192.0.2.10");
    assert.equal(verdict.ok, false);
    assert.match(verdict.detail, /ANITABI_EGRESS_EXPECTED_IPV4/);
  });

  void it("fails closed when the live address cannot be read", () => {
    const verdict = compareEgressAddress("192.0.2.10", null);
    assert.equal(verdict.ok, false);
  });

  void it("names no address in its messages — a public log learns nothing", () => {
    for (const verdict of [
      compareEgressAddress("192.0.2.10", "192.0.2.11"),
      compareEgressAddress(null, "192.0.2.10"),
      compareEgressAddress("192.0.2.10", null),
      compareEgressAddress("192.0.2.10", "192.0.2.10"),
    ]) {
      assert.doesNotMatch(verdict.detail, /\b192\.0\.2\./);
    }
  });
});
