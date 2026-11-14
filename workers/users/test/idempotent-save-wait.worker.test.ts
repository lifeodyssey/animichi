/**
 * SUT: the Worker's idempotent save when another request still holds the key's
 * claim (N6), through the Worker entry. The router passes the save no options,
 * so what runs here is the production wait: a real-timer pause between re-reads
 * and the production bound. vitest's fake timers stand in for the clock, so the
 * test moves time itself and no real time passes. The answer at the bound must
 * stay one the contract's registry marks retryable, which the client relies on.
 */
import {
  IDEMPOTENCY_KEY_HEADER, USERS_ERROR_DEFS, type SaveSavedRouteInput, type UsersErrorCode,
} from "@animichi/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUsersApp } from "../src/index";
import {
  canonicalFingerprint, IDEMPOTENCY_EXECUTION_TIMEOUT_MS, IDEMPOTENCY_RETENTION_MS,
} from "../src/domain/saved-route-idempotency";
import { identityHeaders, TEST_ENV } from "./identity-fixture";
import { fakeUsersPrisma, ledgerKey, type FakeLedgerRow, type FakeUsersPrisma } from "./fake-users-prisma";

const NOW = Date.parse("2026-07-13T04:00:00.000Z");
const KEY = "key-001";
const INPUT: SaveSavedRouteInput = { title: "Tokyo", point_ids: ["p1"], status: "saved" };
/** The route the claim holder commits, as its ledger snapshot carries it. */
const HOLDERS_ROUTE = {
  id: "00000000-0000-7000-8000-000000000001", title: "Tokyo", point_ids: ["p1"],
  status: "saved", saved_at: "2026-07-13T04:00:00.000Z", updated_at: "2026-07-13T04:00:00.000Z",
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The claim another request holds on this key: claimed just now, not committed. */
function claimHeldElsewhere(): { store: FakeUsersPrisma; row: FakeLedgerRow } {
  const store = fakeUsersPrisma();
  const row: FakeLedgerRow = {
    owner_user_id: "user-a", op: "saveSavedRoute", key: KEY, fingerprint: canonicalFingerprint(INPUT),
    state: "in_progress", result: null, result_id: null,
    created_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + IDEMPOTENCY_RETENTION_MS).toISOString(),
  };
  store.idemRows.set(ledgerKey(row.owner_user_id, row.op, row.key), row);
  return { store, row };
}

/** POST the same payload under the same key, and note when the Worker answers. */
function duplicateSave(store: FakeUsersPrisma) {
  const app = createUsersApp({ makePrisma: () => store.prisma });
  const headers = identityHeaders("user-a", { "content-type": "application/json", [IDEMPOTENCY_KEY_HEADER]: KEY });
  const response = Promise.resolve(app.request("/v1/users/saved-routes", {
    method: "POST", headers, body: JSON.stringify(INPUT),
  }, TEST_ENV));
  const progress = { answered: false };
  void response.then(() => { progress.answered = true; });
  return { response, progress };
}

describe("the Worker's duplicate save waits for an in-flight claim (N6)", () => {
  it("has not answered at 1 999 ms and answers the retryable 409 at the 2 s bound", async () => {
    const save = duplicateSave(claimHeldElsewhere().store);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(save.progress.answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(save.progress.answered).toBe(true);
    const response = await save.response;
    expect(response.status).toBe(409);
    const body = await response.json<{ code: UsersErrorCode }>();
    expect(body).toMatchObject({ defined: true, code: "IDEMPOTENCY_IN_FLIGHT", status: 409 });
    expect(USERS_ERROR_DEFS[body.code].category).toBe("retryable");
  });

  it("answers with the claim holder's route when it commits during the wait", async () => {
    const held = claimHeldElsewhere();
    const save = duplicateSave(held.store);
    // The duplicate re-reads at 250, 500 and 750 ms; the holder commits between the second and third.
    await vi.advanceTimersByTimeAsync(600);
    expect(save.progress.answered).toBe(false);
    Object.assign(held.row, { state: "committed", result: HOLDERS_ROUTE, result_id: HOLDERS_ROUTE.id });
    await vi.advanceTimersByTimeAsync(150);
    expect(save.progress.answered).toBe(true);
    const response = await save.response;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(HOLDERS_ROUTE);
  });

  it("reclaims a claim that goes stale during the wait and saves the route itself", async () => {
    const held = claimHeldElsewhere();
    // 100 ms of the claim's liveness window remain, so the first re-read, 250 ms on, finds it stale.
    held.row.created_at = new Date(NOW - IDEMPOTENCY_EXECUTION_TIMEOUT_MS + 100).toISOString();
    const save = duplicateSave(held.store);
    await vi.advanceTimersByTimeAsync(250);
    expect(save.progress.answered).toBe(true);
    const response = await save.response;
    expect(response.status).toBe(200);
    expect(held.store.rows).toHaveLength(1);
  });
});
