import type { DeleteSavedRouteInput } from "@animichi/contract";
import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { deleteSavedRoute } from "../src/application/delete-saved-route";
import type {
  DeleteOwnedOutcome,
  DeleteSavedRouteObserver,
  DeleteSavedRouteObservability,
  DeleteSavedRouteStore,
} from "../src/application/delete-saved-route";
import type { UsersPrisma } from "../src/db/prisma";
import { fakeUsersPrisma, type FakeSavedRouteRow } from "./fake-users-prisma";

const ID = "00000000-0000-4000-8000-000000000009";
const UNKNOWN = "00000000-0000-4000-8000-000000000008";

function repo(prisma: UsersPrisma): DeleteSavedRouteStore {
  return new NeonSavedRouteStore(prisma);
}

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: ID, user_id: "user-a", title: "Tokyo", point_ids: ["p1"],
    status: "saved", saved_at: null, updated_at: "2026-07-13T04:00:00.000Z", ...overrides,
  };
}

function recordingObserver(): {
  observer: DeleteSavedRouteObserver; records: DeleteSavedRouteObservability[];
} {
  const records: DeleteSavedRouteObservability[] = [];
  return { observer: { record: (record) => { records.push(record); } }, records };
}

function storeReturning(outcome: DeleteOwnedOutcome): DeleteSavedRouteStore {
  return { deleteOwned: () => Promise.resolve(outcome) };
}

async function errorFor(
  input: DeleteSavedRouteInput,
  store: ReturnType<typeof fakeUsersPrisma>,
): Promise<ORPCError<string, unknown>> {
  try {
    await deleteSavedRoute(repo(store.prisma), "user-a", input);
  } catch (error) {
    expect(error).toBeInstanceOf(ORPCError);
    return error as ORPCError<string, unknown>;
  }
  throw new Error("expected deleteSavedRoute to reject");
}

describe("DeleteSavedRoute deletes an owned route", () => {
  it("returns deleted for an owned route", async () => {
    await expect(deleteSavedRoute(repo(fakeUsersPrisma([row()]).prisma), "user-a", { id: ID }))
      .resolves.toEqual({ deleted: true });
  });

  it("runs exactly one atomic delete with no ownership read", async () => {
    const store = fakeUsersPrisma([row()]);
    await deleteSavedRoute(repo(store.prisma), "user-a", { id: ID });
    // One statement, and the owned row is gone from the in-memory store.
    expect(store.queries).toHaveLength(1);
    expect(store.rows).toHaveLength(0);
  });
});

describe("DeleteSavedRoute rejects unauthorized or absent routes", () => {
  it("returns SAVED_ROUTE_NOT_FOUND for an unknown id", async () => {
    const error = await errorFor({ id: UNKNOWN }, fakeUsersPrisma());
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND", status: 404, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_OWNED for another user's route", async () => {
    const store = fakeUsersPrisma([row({ user_id: "user-b" })]);
    const error = await errorFor({ id: ID }, store);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_OWNED when the delete loses the race", async () => {
    // The row arrives between the owner-predicated DELETE and the id-only
    // existence probe that classifies the loss.
    const store = fakeUsersPrisma([], {
      beforePlan: (index) => { if (index === 1) store.rows.push(row()); },
    });
    const error = await errorFor({ id: ID }, store);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_FOUND when the row vanishes before the delete", async () => {
    const error = await errorFor({ id: ID }, fakeUsersPrisma());
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND", status: 404, defined: true });
  });
});

describe("DeleteSavedRoute propagates a store failure", () => {
  it("re-throws a persistence failure", async () => {
    const failing: DeleteSavedRouteStore = {
      deleteOwned: () => Promise.reject(new Error("database unavailable")),
    };
    await expect(deleteSavedRoute(failing, "user-a", { id: ID })).rejects.toThrow("database unavailable");
  });
});

describe("DeleteSavedRoute records redacted observability", () => {
  it("records deleted for an owned route", async () => {
    const { observer, records } = recordingObserver();
    await deleteSavedRoute(repo(fakeUsersPrisma([row()]).prisma), "user-a", { id: ID }, { observer });
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("deleted");
    expect(typeof records[0]?.duration_ms).toBe("number");
  });

  it("records rejected for another user's route", async () => {
    const { observer, records } = recordingObserver();
    await expect(deleteSavedRoute(storeReturning({ kind: "not_owned" }), "user-a", { id: ID }, { observer }))
      .rejects.toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED" });
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("rejected");
  });

  it("records missing for an absent route", async () => {
    const { observer, records } = recordingObserver();
    await expect(deleteSavedRoute(storeReturning({ kind: "missing" }), "user-a", { id: ID }, { observer }))
      .rejects.toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND" });
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("missing");
  });

  it("records failure when the store rejects", async () => {
    const { observer, records } = recordingObserver();
    const failing: DeleteSavedRouteStore = { deleteOwned: () => Promise.reject(new Error("db")) };
    await expect(deleteSavedRoute(failing, "user-a", { id: ID }, { observer })).rejects.toThrow("db");
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("failure");
  });
});

describe("DeleteSavedRoute mutation guards", () => {
  it("scopes the atomic delete statement to the owning user", async () => {
    // The fake evaluates the DELETE's WHERE against the stored rows, so
    // removing the owner's row proves the write is user-scoped.
    const store = fakeUsersPrisma([row()]);
    await deleteSavedRoute(repo(store.prisma), "user-a", { id: ID });
    expect(store.rows).toHaveLength(0);
  });

  it("leaves another user's row and reports it as not owned", async () => {
    const store = fakeUsersPrisma([row({ user_id: "user-b" })]);
    await expect(deleteSavedRoute(repo(store.prisma), "user-a", { id: ID }))
      .rejects.toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED" });
    expect(store.rows).toHaveLength(1);
  });
});
