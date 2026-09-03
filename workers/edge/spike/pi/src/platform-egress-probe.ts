// W0-S5 spike (#1248): what the PLATFORM refuses, measured separately from
// what the application policy refuses.
//
// The acceptance criterion asks the deployed run to distinguish the two. On a
// denied row that is not directly observable — the app policy answers first and
// nothing is ever sent — so this probe asks the other half of the question
// directly: with no policy in the way at all, what does Hosted Workers' own
// outbound proxy do with each of these addresses?
//
// The target list is a COMPILE-TIME CONSTANT and nothing from a request reaches
// `fetch` here. That is what keeps this a measurement rather than an SSRF hole
// bolted onto a deployed Worker: a caller can trigger the probe, but cannot
// choose, extend or redirect what it probes, and only the outcome shape comes
// back — never a response body.

import { thrownMessageOf } from "../../../src/agent/egress/secret-scrub.ts";

export const PLATFORM_PROBE_TARGETS: readonly string[] = [
  "http://169.254.169.254/latest/meta-data/",
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://10.0.0.1/",
  "http://127.0.0.1/",
  "http://[::1]/",
  "http://[fd00::1]/",
  "http://100.64.0.1/",
  // Real public names whose A record is 127.0.0.1 — the DNS half of the red
  // line. The application policy refuses them by name (they are not on the
  // allowlist); these rows say whether the platform ALSO refuses them after
  // resolving, which is the only place a resolver-level answer can come from.
  "http://localtest.me/",
  "http://127.0.0.1.nip.io/",
];

const PROBE_TIMEOUT_MS = 3000;

export interface PlatformProbeRow {
  target: string;
  outcome: "reachable" | "blocked";
  /** The runtime's own refusal text, or the status it answered with. */
  detail: string;
}

type PlainFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function probeOne(target: string, inner: PlainFetch): Promise<PlatformProbeRow> {
  try {
    const response = await inner(target, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return { target, outcome: "reachable", detail: `status=${String(response.status)}` };
  } catch (error) {
    return { target, outcome: "blocked", detail: refusalTextOf(error) };
  }
}

function refusalTextOf(error: unknown): string {
  return thrownMessageOf(error).slice(0, 200);
}

export function probePlatformEgress(
  inner: PlainFetch = (target, init) => fetch(target, init),
): Promise<PlatformProbeRow[]> {
  return Promise.all(PLATFORM_PROBE_TARGETS.map((target) => probeOne(target, inner)));
}
