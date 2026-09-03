/**
 * W1-7 (#1256): the anonymous daily-message CEILING, the half #1251 left
 * unowned. `quota-reservation.ts` reserves a message on the counter row; this
 * is the allowance that row may not exceed, ported from Python's
 * `anonymous_quota_verdict` (`apps/agent/src/animichi/application/admission_limits.py`):
 * `0`/unset disables the check entirely, and the rejection names the next UTC
 * midnight so a client can auto-unlock instead of guessing at "today".
 *
 * test-type: unit (pure functions, no clock of their own).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  anonymousMessageAllowance,
  allowanceExceeded,
  quotaResetsAt,
  QuotaExhaustedError,
} from "../src/agent/intake/anonymous-message-allowance.ts";

void test("an unset allowance disables the ceiling, the same convention as the budget breaker", () => {
  assert.equal(anonymousMessageAllowance(undefined), 0);
  assert.equal(allowanceExceeded(9_999, anonymousMessageAllowance(undefined)), false);
});

void test('the literal "0" disables it too', () => {
  assert.equal(anonymousMessageAllowance("0"), 0);
  assert.equal(allowanceExceeded(1, 0), false);
});

void test("a malformed or negative value disables the ceiling rather than refusing everyone", () => {
  assert.equal(anonymousMessageAllowance("twenty"), 0);
  assert.equal(anonymousMessageAllowance("-3"), 0);
  assert.equal(anonymousMessageAllowance(""), 0);
});

void test("the configured value is the number of messages one identity may reserve in a day", () => {
  assert.equal(anonymousMessageAllowance("20"), 20);
});

void test("the twentieth reservation of a 20-message allowance is still admitted", () => {
  assert.equal(allowanceExceeded(20, 20), false);
});

void test("the twenty-first is refused — Python's count >= quota, read after the reservation", () => {
  assert.equal(allowanceExceeded(21, 20), true);
});

void test("the allowance returns at the next UTC midnight after the day it was spent", () => {
  assert.equal(quotaResetsAt("2026-09-02"), "2026-09-03T00:00:00Z");
});

void test("the reset instant crosses a month boundary by calendar, not by arithmetic", () => {
  assert.equal(quotaResetsAt("2026-09-30"), "2026-10-01T00:00:00Z");
});

void test("the refusal carries the reset instant it will be answered with", () => {
  const error = new QuotaExhaustedError("2026-09-02");
  assert.equal(error.resetsAt, "2026-09-03T00:00:00Z");
  assert.equal(error.name, "QuotaExhaustedError");
});
