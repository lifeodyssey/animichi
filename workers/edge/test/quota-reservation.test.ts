/**
 * W1-2 (#1251): which turns charge the per-identity daily message quota, and
 * which counter row they charge. Ported from the Python intake's
 * `anon_quota_eligible` + `utc_today` (apps/agent
 * `application/admission_limits.py`), so the cases mirror that module's own:
 * identity shape decides eligibility, and the day is the UTC calendar day the
 * `anon_daily_message_count` primary key is made of.
 *
 * test-type: unit (pure functions, injected clock, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { quotaReservationFor, utcUsageDate } from "../src/agent/intake/quota-reservation.ts";

const ANON_ID = "anon_0123456789abcdef0123456789abcdef";
/** 2026-09-02T23:30:00Z — late enough in the UTC day to catch a local-time slip. */
const LATE_IN_THE_DAY = Date.parse("2026-09-02T23:30:00.000Z");

void test("an anonymous turn reserves against its own identity and the UTC day", () => {
  assert.deepEqual(quotaReservationFor("anon", ANON_ID, LATE_IN_THE_DAY), {
    identityId: ANON_ID,
    usageDate: "2026-09-02",
  });
});

void test("the usage date rolls at UTC midnight, not at a local one", () => {
  assert.equal(utcUsageDate(LATE_IN_THE_DAY), "2026-09-02");
  assert.equal(utcUsageDate(LATE_IN_THE_DAY + 31 * 60_000), "2026-09-03");
});

void test("a signed-in turn is not metered by the anonymous counter", () => {
  assert.equal(quotaReservationFor("user", ANON_ID, LATE_IN_THE_DAY), null);
});

void test("a BYOK turn spends the visitor's own key, so it reserves nothing", () => {
  assert.equal(quotaReservationFor("byok", ANON_ID, LATE_IN_THE_DAY), null);
});

void test("an identity that is not the edge's anonymous shape is not metered", () => {
  const notAnonymous = ["anon_short", "anon_0123456789ABCDEF0123456789abcdef", "user_42", ANON_ID + "0"];
  const reserved = notAnonymous.map((id) => quotaReservationFor("anon", id, LATE_IN_THE_DAY));
  assert.deepEqual(reserved, [null, null, null, null]);
});
