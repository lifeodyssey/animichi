/**
 * SUT: the error envelopes the users worker puts on the wire — the defined oRPC
 * errors `src/lib/errors.ts` constructs, and the Idempotency-Key 400 that
 * `src/index.ts` writes before dispatch. Each carries the status and message the
 * contract's `USERS_ERROR_DEFS` registry gives its code, for every code the
 * registry holds.
 *
 * A code, status or message changed in the registry is therefore either followed
 * here (the worker reads the registry) or turns this file red (a copy that
 * drifted, or a registry code with no producer below). Every code is driven
 * through the Worker entry except IDEMPOTENCY_IN_FLIGHT, which only a claim still
 * in flight produces: its constructor's `toJSON()` is the envelope the handler
 * serializes, and test/idempotent-save-wait.worker.test.ts drives it to the wire.
 */
import {
  IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_MAX_LENGTH, USERS_ERROR_DEFS,
  type SaveSavedRouteInput, type UsersErrorCode,
} from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { createUsersApp } from "../src/index";
import { savedRouteIdempotencyInFlight } from "../src/lib/errors";
import { identityHeaders, TEST_ENV } from "./identity-fixture";
import { fakeUsersPrisma, type FakeSavedRouteRow } from "./fake-users-prisma";

const ROUTE_ID = "00000000-0000-4000-8000-00000000000a";
const UNKNOWN_ID = "00000000-0000-4000-8000-00000000000f";
const KEY = "key-001";
const TOKYO: SaveSavedRouteInput = { title: "Tokyo", point_ids: ["p1"], status: "saved" };
const OSAKA: SaveSavedRouteInput = { title: "Osaka", point_ids: ["p9"], status: "saved" };

/** An error as a client of this worker receives it. */
interface WireError { readonly status: number; readonly body: unknown }

type UsersApp = ReturnType<typeof createUsersApp>;

/** What the app answers a request with: a Response, or a promise of one. */
type Reply = ReturnType<UsersApp["request"]>;

function usersApp(seed: FakeSavedRouteRow[] = []): UsersApp {
  const store = fakeUsersPrisma(seed);
  return createUsersApp({ makePrisma: () => store.prisma });
}

function routeOwnedBy(userId: string): FakeSavedRouteRow {
  return {
    id: ROUTE_ID, user_id: userId, title: "Tokyo", point_ids: [],
    status: "saved", saved_at: null, updated_at: "2026-07-13T04:00:00.000Z",
  };
}

async function wire(reply: Reply): Promise<WireError> {
  const response = await reply;
  return { status: response.status, body: await response.json() };
}

function save(app: UsersApp, key: string, input: SaveSavedRouteInput): Reply {
  const headers = identityHeaders("user-a", { "content-type": "application/json", [IDEMPOTENCY_KEY_HEADER]: key });
  return app.request("/v1/users/saved-routes", { method: "POST", headers, body: JSON.stringify(input) }, TEST_ENV);
}

function remove(app: UsersApp, id: string): Reply {
  return app.request(`/v1/users/saved-routes/${id}`, { method: "DELETE", headers: identityHeaders("user-a") }, TEST_ENV);
}

/** The key reused with a different payload after the first save committed. */
async function conflictingSave(): Promise<WireError> {
  const app = usersApp();
  await save(app, KEY, TOKYO);
  return wire(save(app, KEY, OSAKA));
}

/** How each registry code reaches a client of this worker. */
const PRODUCERS: Record<UsersErrorCode, () => Promise<WireError>> = {
  SAVED_ROUTE_NOT_FOUND: () => wire(remove(usersApp(), UNKNOWN_ID)),
  SAVED_ROUTE_NOT_OWNED: () => wire(remove(usersApp([routeOwnedBy("user-b")]), ROUTE_ID)),
  IDEMPOTENCY_CONFLICT: conflictingSave,
  IDEMPOTENCY_IN_FLIGHT: () => {
    const error = savedRouteIdempotencyInFlight();
    return Promise.resolve({ status: error.status, body: error.toJSON() });
  },
  IDEMPOTENCY_KEY_INVALID: () => wire(save(usersApp(), "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1), TOKYO)),
};

describe("the users worker's error envelopes follow the contract registry", () => {
  it.each(Object.keys(USERS_ERROR_DEFS) as UsersErrorCode[])(
    "puts %s on the wire with the registry's status and message",
    async (code) => {
      const { status, message } = USERS_ERROR_DEFS[code];
      const error = await PRODUCERS[code]();
      expect(error.status).toBe(status);
      expect(error.body).toMatchObject({ defined: true, code, status, message });
    },
  );
});
