import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANON_QUOTA_PURGE_SQL,
  FIND_PURGEABLE_SESSIONS_SQL,
  PURGE_ANONYMOUS_SESSION_SQL,
  purgeAnonQuotaCounts,
  purgeAnonymousSessions,
  type DatabaseClient,
  type QueryResult,
} from "../src/purge";

const NOW = new Date("2026-07-26T23:59:58.321Z");
const SESSION_CUTOFF = new Date("2026-06-26T23:59:58.321Z");

function result(rowCount: number, rows: QueryResult["rows"] = []): QueryResult {
  return { rowCount, rows };
}

function database(): DatabaseClient {
  return { query: vi.fn<DatabaseClient["query"]>() };
}

/** One eligible candidate, then a successful atomic delete of it. */
function databaseWithOnePurgeableSession(): DatabaseClient {
  const db = database();
  vi.mocked(db.query)
    .mockResolvedValueOnce(result(1, [{ session_id: "sess-a" }]))
    .mockResolvedValueOnce(result(1));
  return db;
}

// The two SQL constants are re-stated here verbatim rather than imported into the
// assertion, so an edit to src/purge.ts cannot silently redefine what "equivalent to
// the Python original" means. Sources: session.py:31-37 and session.py:45-50,242-265.
const EXPECTED_FIND_SQL = [
  "SELECT c.session_id",
  "FROM conversations c",
  "WHERE c.user_id LIKE 'anon\\_%' ESCAPE '\\'",
  "  AND c.updated_at < $1",
  "  AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.session_id = c.session_id)",
].join("\n");

const EXPECTED_PURGE_SQL = [
  "WITH deleted_conversation AS (",
  "  DELETE FROM conversations",
  "  WHERE session_id = $1",
  "    AND user_id LIKE 'anon\\_%' ESCAPE '\\'",
  "    AND updated_at < $2",
  "  RETURNING session_id",
  ")",
  "DELETE FROM sessions",
  "WHERE id IN (SELECT session_id FROM deleted_conversation)",
].join("\n");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("anonymous quota retention", () => {
  it("uses the Python DELETE shape and a UTC date cutoff from the mocked clock", async () => {
    const db = database();
    vi.mocked(db.query).mockResolvedValue(result(3));

    await expect(purgeAnonQuotaCounts(db)).resolves.toBe(3);

    expect(ANON_QUOTA_PURGE_SQL).toBe(
      "DELETE FROM anon_daily_message_count WHERE usage_date < $1",
    );
    expect(db.query).toHaveBeenCalledWith(ANON_QUOTA_PURGE_SQL, ["2026-06-26"]);
  });
});

describe("anonymous session retention", () => {
  it("uses the Python eligibility predicates and timestamp cutoff", async () => {
    const db = databaseWithOnePurgeableSession();

    await expect(purgeAnonymousSessions(db)).resolves.toEqual({ purged: 1, raced: 0, failed: 0 });

    expect(FIND_PURGEABLE_SESSIONS_SQL).toBe(EXPECTED_FIND_SQL);
    expect(db.query).toHaveBeenNthCalledWith(1, FIND_PURGEABLE_SESSIONS_SQL, [SESSION_CUTOFF]);
  });

  it("re-checks the Python delete predicates in one atomic per-session query", async () => {
    const db = databaseWithOnePurgeableSession();

    await purgeAnonymousSessions(db);

    expect(PURGE_ANONYMOUS_SESSION_SQL).toBe(EXPECTED_PURGE_SQL);
    expect(db.query).toHaveBeenNthCalledWith(2, PURGE_ANONYMOUS_SESSION_SQL, [
      "sess-a",
      SESSION_CUTOFF,
    ]);
  });
});

describe("anonymous session race handling", () => {
  it("isolates an FK race and continues the sweep", async () => {
    const db = database();
    const fkViolation = Object.assign(new Error("routes_session_id_fkey"), { code: "23503" });
    vi.mocked(db.query)
      .mockResolvedValueOnce(result(2, [{ session_id: "sess-race" }, { session_id: "sess-b" }]))
      .mockRejectedValueOnce(fkViolation)
      .mockResolvedValueOnce(result(1));

    await expect(purgeAnonymousSessions(db)).resolves.toEqual({ purged: 1, raced: 0, failed: 1 });
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  it("reports a re-check miss as raced", async () => {
    const db = database();
    vi.mocked(db.query)
      .mockResolvedValueOnce(result(1, [{ session_id: "sess-raced" }]))
      .mockResolvedValueOnce(result(0));

    await expect(purgeAnonymousSessions(db)).resolves.toEqual({ purged: 0, raced: 1, failed: 0 });
  });

  it("propagates a non-FK database failure", async () => {
    const db = database();
    vi.mocked(db.query)
      .mockResolvedValueOnce(result(1, [{ session_id: "sess-a" }]))
      .mockRejectedValueOnce(new Error("boom"));

    await expect(purgeAnonymousSessions(db)).rejects.toThrow("boom");
  });

  it("rejects a malformed candidate row", async () => {
    const db = database();
    vi.mocked(db.query).mockResolvedValueOnce(result(1, [{ session_id: 42 }]));

    await expect(purgeAnonymousSessions(db)).rejects.toThrow(
      "Purge candidate has no string session_id",
    );
  });
});
