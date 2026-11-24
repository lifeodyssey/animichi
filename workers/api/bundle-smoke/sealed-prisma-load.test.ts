/**
 * SUT: the sealed API Worker release CD uploads (`sealed-release.ts`), built once by the release script
 * and observed twice: booted in workerd, and profiled by `wrangler check startup`.
 *
 * Cloudflare refuses a Worker whose startup, the evaluation of its global scope, takes longer than a
 * second, so Prisma's runtime and the contract's validation load on the first call that needs a client
 * (`src/native-client.ts`), not at startup. A broken Prisma or contract therefore fails the first
 * request that opens the database, where it used to refuse the deploy, and CD's staging smoke requests
 * only `/healthz`, which builds no client. The boot stands in for it: an anonymous visitor's transcript
 * reads are first uses, driven until a client exists. With no database behind it, the client fails at
 * connect, and the route answers the 500 it answers any failure. A failed load answers that same 500,
 * so the answer cannot tell the two apart; the connections reaching this file's own listener
 * (`connection-witness.ts`) can, because only a built client makes one.
 *
 * The profile shows the same release's startup runs no ArkType and no geography-pack code, the work
 * the first use loads (`startup-profile.ts`). A global scope that throws reads as an empty, fast start,
 * so the profile proves no start on its own: it stands beside the boot of the same bytes.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Miniflare } from "miniflare";
import { anonymousVisitorCookie } from "./anonymous-visitor.ts";
import { startConnectionWitness } from "./connection-witness.ts";
import { bootSealedRelease, discardSealedRelease } from "./sealed-release.ts";
import { profileSealedStartup } from "./startup-profile.ts";

after(() => discardSealedRelease());

/** The release build plus a boot, or a profile: room for the 60 s each Wrangler run is bounded by. */
const SEALED_BOUND_MS = 120_000;
const ANON_ID_SECRET = "fixed-test-hmac-key-0000000000000000";
const TRANSCRIPT = "https://api.test/v1/conversations/11111111-1111-4111-8111-111111111111/messages";
/** What the route answers a request whose database work threw. */
const INTERNAL_ERROR = { status: 500, code: "internal_error" };

async function readTranscript(worker: Miniflare, cookie: string) {
  const response = await worker.dispatchFetch(TRANSCRIPT, { headers: { cookie } });
  return { status: response.status, code: (await response.json() as { error: { code: string } }).error.code };
}

void test("the sealed API Worker starts, and its first transcript reads load Prisma until the client tries the database", { timeout: SEALED_BOUND_MS }, async (context) => {
  const database = await startConnectionWitness();
  context.after(() => database.close());
  const bindings = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET, EDGE_SHOWCASE_MODE: "false", AGENT_SVC_DATABASE_URL: database.dsn };
  const { worker, outbound } = await bootSealedRelease(bindings);
  context.after(() => worker.dispose());
  const cookie = await anonymousVisitorCookie(ANON_ID_SECRET);
  assert.deepEqual(await Promise.all([readTranscript(worker, cookie), readTranscript(worker, cookie)]), [INTERNAL_ERROR, INTERNAL_ERROR]);
  assert.deepEqual(await readTranscript(worker, cookie), INTERNAL_ERROR);
  assert.deepEqual({ connections: database.connections(), outbound }, { connections: 3, outbound: [] });
});

void test("the same release's startup runs no ArkType or geography-pack code", { timeout: SEALED_BOUND_MS }, async () => {
  const startup = await profileSealedStartup();
  assert.ok(startup.firstUseSourcesInBundle > 0, "the bundle carries ArkType and the geography pack");
  assert.ok(startup.attributedSamples > 0, "the bundle's source map attributes the profile's frames");
  assert.equal(startup.firstUseSamplesAtStartup, 0);
});
