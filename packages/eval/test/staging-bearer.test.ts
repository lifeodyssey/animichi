/**
 * The credential's age rule (W3-2 #1300).
 *
 * The clock is a fixture, not a wait: the Neon Auth JWT lives 15 minutes, and a
 * re-mint rule that could only be observed by sitting through fourteen of them
 * is a rule nobody would ever run.
 *
 * test-type: unit (fake clock, no network).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { BEARER_MAX_AGE_MS, StagingBearer } from "../src/staging-bearer.ts";

/** A clock the test moves, and a mint that says which one it handed out. */
function mintedBearer(): { bearer: StagingBearer; advance: (ms: number) => void; mints: () => number } {
  let now = 1_700_000_000_000;
  let minted = 0;
  const bearer = new StagingBearer(
    () => {
      minted += 1;
      return Promise.resolve(`token-${String(minted)}`);
    },
    () => now,
  );
  return { bearer, advance: (ms) => (now += ms), mints: () => minted };
}

void test("the first turn mints a token", async () => {
  const { bearer, mints } = mintedBearer();
  assert.equal(await bearer.current(), "token-1");
  assert.equal(mints(), 1);
});

void test("a token inside its window is reused, not re-minted", async () => {
  const { bearer, advance, mints } = mintedBearer();
  await bearer.current();
  advance(BEARER_MAX_AGE_MS - 1);
  assert.equal(await bearer.current(), "token-1");
  assert.equal(mints(), 1);
});

void test("a token older than the window is re-minted before it is presented", async () => {
  const { bearer, advance } = mintedBearer();
  await bearer.current();
  advance(BEARER_MAX_AGE_MS);
  assert.equal(await bearer.current(), "token-2");
});

void test("the window stops a minute short of the 15-minute JWT lifetime", () => {
  assert.equal(BEARER_MAX_AGE_MS, 14 * 60_000);
});

/**
 * Concurrent turns find the same stale token at the same moment. One sign-in is
 * the correct answer; N sign-ins would be N rate-limited requests to Neon Auth
 * at exactly the point a long run is busiest.
 */
void test("turns that all find the token stale together cause one sign-in", async () => {
  const { bearer, mints } = mintedBearer();
  const tokens = await Promise.all([bearer.current(), bearer.current(), bearer.current()]);
  assert.deepEqual(tokens, ["token-1", "token-1", "token-1"]);
  assert.equal(mints(), 1);
});
