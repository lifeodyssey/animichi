// W0-S5 spike (#1248): the red line `POST /egress` cannot reach.
//
// Redirect re-validation only happens after a first hop is allowed, and under
// the real allowlist no redirect fixture is an allowed first hop — the policy
// refuses the fixture host before any 302 exists to re-validate. So this probe
// runs the SAME `GuardedFetch` against a policy whose only allowed hosts are
// the two fixtures below. That widened allowlist lives here and nowhere else,
// so it cannot become the policy any other route uses, and every URL involved
// is a compile-time constant.
//
// Why two fixtures rather than one public one. httpbingo.org's `/redirect-to`
// only redirects WITHIN its own domain — every off-domain target answers 403,
// verified on 2026-09-03 against `https://169.254.169.254/`, `//169.254.169.254/`,
// `//evil.test/` and `http://10.0.0.1/`. So a public fixture cannot emit a
// hostile `Location` at all. The hostile hops therefore come from a 302 source
// inside this isolate, addressed at a `.invalid` host that can never resolve —
// if the interception ever stopped working the request would go nowhere rather
// than somewhere. httpbingo still supplies the control row, which is the one
// that has to be a real network redirect: without it, "every hostile redirect
// was refused" would also be the result of a guard that never follows anything.

import { EgressDeniedError } from "../../../src/agent/egress/egress-decision.ts";
import { EgressPolicy } from "../../../src/agent/egress/egress-policy.ts";
import { GuardedFetch, type EgressFetch } from "../../../src/agent/egress/guarded-fetch.ts";
import { ProviderAllowlist } from "../../../src/agent/egress/provider-allowlist.ts";

const PUBLIC_FIXTURE_HOST = "httpbingo.org";
const LOCAL_FIXTURE_HOST = "redirect-fixture.invalid";
const FIXTURE_KEY = "spike-redirect-fixture-not-a-credential";

interface FixtureCase {
  name: string;
  expect: string;
  url: string;
  /** The `Location` an in-isolate 302 answers with; `null` = the real network. */
  location: string | null;
}

const FIXTURE_CASES: readonly FixtureCase[] = [
  {
    name: "redirect-to-metadata",
    expect: "metadata_address",
    url: `https://${LOCAL_FIXTURE_HOST}/302`,
    location: "https://169.254.169.254/",
  },
  {
    name: "redirect-off-allowlist",
    expect: "host_not_allowlisted",
    url: `https://${LOCAL_FIXTURE_HOST}/302`,
    location: "https://evil.test/",
  },
  {
    name: "redirect-to-plaintext",
    expect: "scheme_not_https",
    url: `https://${LOCAL_FIXTURE_HOST}/302`,
    location: `http://${PUBLIC_FIXTURE_HOST}/status/418`,
  },
  {
    name: "redirect-followed",
    expect: "followed",
    url: `https://${PUBLIC_FIXTURE_HOST}/redirect-to?url=%2Fstatus%2F418`,
    location: null,
  },
];

export interface RedirectFixtureRow {
  name: string;
  expect: string;
  /** The deny reason, `followed`, or `fetch_failed` when the fixture is down. */
  outcome: string;
  hops: number;
  status: number | null;
}

function fixturePolicy(): EgressPolicy {
  const hosts = [PUBLIC_FIXTURE_HOST, LOCAL_FIXTURE_HOST];
  return new EgressPolicy(new ProviderAllowlist({ openai: hosts, anthropic: [], google: [] }));
}

function redirectSource(location: string): EgressFetch {
  return () => Promise.resolve(new Response(null, { status: 302, headers: { location } }));
}

function sourceFor(fixture: FixtureCase, inner: EgressFetch | undefined): EgressFetch | undefined {
  return fixture.location === null ? inner : redirectSource(fixture.location);
}

async function outcomeOf(
  guarded: GuardedFetch,
  url: string,
): Promise<{ outcome: string; status: number | null }> {
  try {
    const response = await guarded.fetch(url);
    return { outcome: "followed", status: response.status };
  } catch (error) {
    if (error instanceof EgressDeniedError) return { outcome: error.reason, status: null };
    return { outcome: "fetch_failed", status: null };
  }
}

async function runCase(fixture: FixtureCase, inner: EgressFetch | undefined): Promise<RedirectFixtureRow> {
  const guarded = new GuardedFetch({
    provider: "openai",
    key: FIXTURE_KEY,
    policy: fixturePolicy(),
    inner: sourceFor(fixture, inner),
  });
  const { outcome, status } = await outcomeOf(guarded, fixture.url);
  return { name: fixture.name, expect: fixture.expect, outcome, hops: guarded.hops, status };
}

export function probeRedirectFixture(inner?: EgressFetch): Promise<RedirectFixtureRow[]> {
  return Promise.all(FIXTURE_CASES.map((fixture) => runCase(fixture, inner)));
}
