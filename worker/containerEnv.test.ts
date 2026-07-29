import test from "node:test";
import assert from "node:assert/strict";
import { DENIED_EGRESS_CIDRS } from "./containerEnv.ts";

// Pins RuntimeContainer.deniedHosts (#284 Task 7 — egress network policy).
// See docs/ops/cloudflare-hardening.md §6: this is the platform-enforced,
// declarative CIDR denylist that replaces the (confirmed-unavailable)
// NET_ADMIN/iptables option. The three CIDRs below must cover every address
// the spec's Task 7 AC error-path names: 169.254.169.254, 100.100.100.200,
// 10.0.0.1.

void test("DENIED_EGRESS_CIDRS covers RFC1918 + link-local + CGNAT", () => {
  assert.deepEqual(DENIED_EGRESS_CIDRS, [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "100.64.0.0/10",
  ]);
});

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const toInt = (addr: string) =>
    addr.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(range) & mask);
}

void test("spec Task 7 AC error-path addresses are covered by some denied CIDR", () => {
  const specAddresses = ["169.254.169.254", "100.100.100.200", "10.0.0.1"];
  for (const address of specAddresses) {
    const covered = DENIED_EGRESS_CIDRS.some((cidr) => ipInCidr(address, cidr));
    assert.equal(covered, true, `${address} must be covered by a denied CIDR`);
  }
});

void test("spec Task 7 AC happy-path address is NOT covered by any denied CIDR", () => {
  const publicAddress = "1.1.1.1"; // Cloudflare public DNS — a public address
  const covered = DENIED_EGRESS_CIDRS.some((cidr) => ipInCidr(publicAddress, cidr));
  assert.equal(covered, false);
});
