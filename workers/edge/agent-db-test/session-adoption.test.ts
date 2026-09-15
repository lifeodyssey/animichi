import assert from "node:assert/strict";
import { test } from "node:test";
import { adoptSessions, ADOPT_TURN_KEY_PREFIX } from "../src/identity/session-adopt.ts";
import { signedAidCookie } from "../test/doubles/signed-anonymous-cookie.ts";
import {
  ACCOUNT_ID, ANON_ID, CONFLICT_ANON_ID, CONFLICT_SESSION, THIRD_PARTY_ID, THIRD_PARTY_SESSION,
  WITH_RESERVATION, WITHOUT_RESERVATION, adoptResponse, db, installConflictTrigger, readAdoptionWrites,
  readConflictRow, readMarkerCount, readMarkers, readOwner, readOwners, removeConflictTrigger,
  seedConflictSession, type MarkerRow, type OwnerRow,
} from "./session-adoption-fixture.ts";

const EXPECTED_OWNERS: OwnerRow[] = [
  { id: WITH_RESERVATION, owner: ACCOUNT_ID },
  { id: WITHOUT_RESERVATION, owner: ACCOUNT_ID },
  { id: THIRD_PARTY_SESSION, owner: THIRD_PARTY_ID },
];
const EXPECTED_MARKERS: MarkerRow[] = [
  { session_id: WITH_RESERVATION, turn_key: `${ADOPT_TURN_KEY_PREFIX}${WITH_RESERVATION}`, payer: "anon", identity_id: null, revision: 2, status: "completed" },
  { session_id: WITHOUT_RESERVATION, turn_key: `${ADOPT_TURN_KEY_PREFIX}${WITHOUT_RESERVATION}`, payer: "anon", identity_id: null, revision: 1, status: "completed" },
];
const EXPECTED_CONFLICT_RESULT = { adopted: 1, noop_class: "adopted", revisions_bumped: 0 };
const EXPECTED_CONFLICT_ROW = {
  session_id: CONFLICT_SESSION, turn_key: "concurrent-conflict", payer: "anon",
  identity_id: CONFLICT_ANON_ID, revision: 2, status: "completed",
};
const MISSING_IDENTITY_RESULT = { adopted: 0, noop_class: "no_anonymous_identity", revisions_bumped: 0 };

async function adoptionEvidence() {
  const first = await adoptSessions(db, ANON_ID, ACCOUNT_ID);
  const owners = await readOwners();
  const markers = await readMarkers();
  const second = await adoptSessions(db, ANON_ID, ACCOUNT_ID);
  const markerCount = await readMarkerCount();
  return { first, owners, markers, second, markerCount };
}

void test("native adoption updates only anonymous sessions and marks each session idempotently", async () => {
  const evidence = await adoptionEvidence();
  assert.deepEqual(evidence.first, { adopted: 2, noop_class: "adopted", revisions_bumped: 2 });
  assert.deepEqual(evidence.owners, EXPECTED_OWNERS);
  assert.deepEqual(evidence.markers, EXPECTED_MARKERS);
  assert.deepEqual(evidence.second, { adopted: 0, noop_class: "no_rows", revisions_bumped: 0 });
  assert.equal(evidence.markerCount, 2);
});

// The missing-identity class must be a no-op in the database, not only in the
// response: comparing real row counts and trigger-maintained `updated_at`
// before and after the request is what turns a write-y fall-through red.
void test("a caller with no anonymous identity leaves session rows and updated_at untouched", async () => {
  const before = await readAdoptionWrites();
  const response = await adoptResponse(ACCOUNT_ID);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), MISSING_IDENTITY_RESULT);
  const after = await readAdoptionWrites();
  assert.equal(after.sessions.length, before.sessions.length);
  assert.equal(after.reservations, before.reservations);
  assert.deepEqual(after.sessions, before.sessions);
});

async function assertConflictAdoption(): Promise<void> {
  const response = await adoptResponse(ACCOUNT_ID, await signedAidCookie(CONFLICT_ANON_ID));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), EXPECTED_CONFLICT_RESULT);
  assert.deepEqual(await readOwner(CONFLICT_SESSION), { id: CONFLICT_SESSION, owner: ACCOUNT_ID });
  assert.deepEqual(await readConflictRow(), EXPECTED_CONFLICT_ROW);
}

void test("a same-next-revision conflict commits adoption without a marker or 500", async () => {
  await seedConflictSession();
  await installConflictTrigger();
  try {
    await assertConflictAdoption();
  } finally {
    await removeConflictTrigger();
  }
});
