/**
 * The pure half of the egress-address guard: compare the expected address
 * (from the environment — never the tree) against the live address (from
 * Fly). Every message names no address, so the guard's output is safe for a
 * public log; the operator compares values in their own terminal via
 * `fly ips list` when they need to see them.
 */

export const EXPECTED_ADDRESS_VAR = "ANITABI_EGRESS_EXPECTED_IPV4";

/** The guard's verdict: ok, or a failure message that names no address. */
export type EgressAddressVerdict = { ok: true; detail: string } | { ok: false; detail: string };

/** The expected address, as the operator or CI supplies it; null = unconfigured. */
export function readExpectedAddress(env: Record<string, string | undefined>): string | null {
  const raw = env[EXPECTED_ADDRESS_VAR];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** The one IPv4 from `fly ips list --json` output; null when nothing usable is there. */
export function ipv4FromFlyIpsJson(json: string): string | null {
  let entries: unknown;
  try {
    entries = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) return null;
  const addresses = entries
    .filter((entry): entry is { address: string } => isEntry(entry) && isIpv4(entry.address))
    .map((entry) => entry.address);
  const [only] = addresses;
  return addresses.length === 1 && typeof only === "string" ? only : null;
}

/** Compare expected vs live; every failure mode fails closed with an address-free message. */
export function compareEgressAddress(expected: string | null, live: string | null): EgressAddressVerdict {
  if (expected === null) {
    return { ok: false, detail: `unconfigured: set ${EXPECTED_ADDRESS_VAR} outside the tree (operator shell or CI secret) and re-run` };
  }
  if (live === null) {
    return { ok: false, detail: "could not read the live address from fly ips list — the guard cannot confirm the allowlist" };
  }
  if (expected !== live) {
    return {
      ok: false,
      detail: "the live egress address differs from the expected one: the upstream allowlist no longer matches. "
        + "Read both values with `fly ips list --app animichi-anitabi-egress`, restore the address or re-allowlist, and update " + EXPECTED_ADDRESS_VAR,
    };
  }
  return { ok: true, detail: "the live egress address matches the expected one" };
}

function isEntry(entry: unknown): entry is { address: string } {
  return typeof entry === "object" && entry !== null
    && typeof (entry as { address?: unknown }).address === "string";
}

/** Dotted-quad IPv4 — an IPv6-only answer is not the address the upstream allowlisted. */
function isIpv4(address: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
}
