/**
 * W2-3's **(api)** evidence (#1289): `POST /v1/byok/probe` answered by the
 * deployed edge tier.
 *
 * DELIBERATELY THE INVALID-KEY HALF ONLY. Every credential this file sends is
 * a zero-entropy fixture that no provider will ever honour, so the lane can
 * live in the repo and be run by anyone: it proves the taxonomy, the login
 * gate and the egress refusal against a REAL deployment without a real key
 * anywhere near it. The valid-key case — the one that answers `vision: true`
 * — is the owner's manual step, because it needs a key that must not be
 * written down (`docs/ops/w1-staging-journey.md` is the model for that).
 *
 * Opt-in and fail-closed like every lane here, through the SAME door
 * (`lane-origin.ts`) — a second reader of `CATALOG_API_ORIGIN` would be a
 * second place the non-HTTPS refusal has to be remembered, and
 * `test/web-search-lane.test.ts` fails if one appears. It needs a signed-in
 * credential for the same reason `agent-turn.test.ts` does — plus one of its
 * own: BYOK is login-gated on both routes that accept it, so an anonymous
 * caller cannot reach the probe at all.
 *
 * Run it only against a deploy carrying `AGENT_TURN_ROUTE = "edge"`. Against
 * the container position the probe is answered by `apps/agent`, which is the
 * shape this tier was written to preserve — the assertions below hold there
 * too, which is exactly the point of a fallback flag.
 *
 * test-type: api (real network against a deployed origin).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { laneBearer, laneOrigin } from "./lane-origin.ts";

/** One probe is bounded at 5s server-side; a client that waited three times
 * that is looking at a hang, not at latency. */
const PROBE_DEADLINE_MS = 15_000;

/** Never a real key: an obviously fake, zero-entropy fixture. */
const FIXTURE_KEY = "byok-test-key-0000";

const OPENAI_HEADERS: Record<string, string> = {
  "X-BYOK-Provider": "openai-compatible",
  "X-BYOK-Key": FIXTURE_KEY,
  "X-BYOK-Model": "gpt-4o-mini",
  "X-BYOK-Base-Url": "https://api.openai.com/v1",
};

function probe(headers: Record<string, string>, authorized = true): Promise<Response> {
  const auth: Record<string, string> = authorized ? { Authorization: `Bearer ${laneBearer()}` } : {};
  return fetch(`${laneOrigin()}/v1/byok/probe`, {
    method: "POST",
    headers: { ...auth, ...headers },
    signal: AbortSignal.timeout(PROBE_DEADLINE_MS),
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

void test("a deliberately invalid key is reported as a rejected credential, not as a broken provider", async () => {
  const response = await probe(OPENAI_HEADERS);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    vision: false,
    reachable: false,
    error_code: "byok_credential_rejected",
  });
});

void test("a base url pointing at the cloud metadata address is refused before anything is sent", async () => {
  const hostile = { ...OPENAI_HEADERS, "X-BYOK-Base-Url": "https://169.254.169.254/v1" };
  const response = await probe(hostile);
  assert.equal(response.status, 400);
  assert.equal(await errorCode(response), "egress_blocked");
});

void test("a probe with no BYOK headers at all is the documented 400", async () => {
  const response = await probe({});
  assert.equal(response.status, 400);
  assert.equal(await errorCode(response), "invalid_request");
});

void test("an unauthenticated probe never reaches a provider", async () => {
  const response = await probe(OPENAI_HEADERS, false);
  assert.equal(response.status, 401);
});
