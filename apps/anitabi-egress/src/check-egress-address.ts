/**
 * The egress-address guard (#1792's quiet-failure criterion): the asset is
 * the allowlisted address, and the dangerous failure is it CHANGING — the
 * allowlist silently stops matching and ingest simply stops succeeding.
 *
 * The expected address is held OUTSIDE the tree (the repository is public;
 * publishing which address holds the allowlist is a needless invitation): it
 * reaches this guard through the `ANITABI_EGRESS_EXPECTED_IPV4` environment
 * variable — the operator's shell, or a CI secret. A committed hash would
 * not actually protect a 32-bit address: the whole IPv4 space brute-forces
 * in seconds, so hashing discloses everything while looking like pinning.
 * The live address is read from Fly at run time:
 *
 *     ANITABI_EGRESS_EXPECTED_IPV4=… pnpm run guard:egress-address
 *
 * which shells out to `fly ips list --app animichi-anitabi-egress --json`
 * (read-only; needs the operator's `fly auth login`). Exit 1 on any failure,
 * with a message that names no address.
 */

import { execFileSync } from "node:child_process";
import { compareEgressAddress, ipv4FromFlyIpsJson, readExpectedAddress } from "./egress-address-guard.ts";

const FLY_APP = "animichi-anitabi-egress";

export function main(): number {
  const expected = readExpectedAddress(process.env);
  const live = liveIpv4();
  const verdict = compareEgressAddress(expected, live);
  if (verdict.ok) {
    console.log("egress address unchanged: the upstream allowlist still matches");
    return 0;
  }
  console.error(`EGRESS ADDRESS GUARD: ${verdict.detail}`);
  return 1;
}

/** `fly ips list --json` for the egress app; null when Fly answers nothing usable. */
function liveIpv4(): string | null {
  try {
    const output = execFileSync("fly", ["ips", "list", "--app", FLY_APP, "--json"], { encoding: "utf8" });
    return ipv4FromFlyIpsJson(output);
  } catch {
    return null;
  }
}

if (process.argv[1]?.endsWith("check-egress-address.ts")) {
  process.exitCode = main();
}
