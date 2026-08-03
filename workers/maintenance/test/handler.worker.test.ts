import { describe, expect, it, vi } from "vitest";
import {
  ANON_QUOTA_CRON,
  ANONYMOUS_SESSIONS_CRON,
  createScheduledHandler,
  type HandlerDependencies,
} from "../src/index";
import type { DatabaseClient } from "../src/purge";

const ENV = { AGENT_DATABASE_URL: "postgresql://agent.example/animichi" };
const NOW = new Date("2026-07-26T23:59:58.321Z");

function dependencies(db: DatabaseClient): HandlerDependencies {
  return { connect: vi.fn(() => db), now: vi.fn(() => NOW) };
}

function database(): DatabaseClient {
  return { query: vi.fn<DatabaseClient["query"]>().mockResolvedValue({ rowCount: 0, rows: [] }) };
}

describe("scheduled handler", () => {
  it("routes the original 19:37 UTC quota cron", async () => {
    const db = database();
    const deps = dependencies(db);

    await createScheduledHandler(deps)({ cron: ANON_QUOTA_CRON }, ENV);

    expect(ANON_QUOTA_CRON).toBe("37 19 * * *");
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("routes the original 18:37 UTC session cron", async () => {
    const db = database();
    const deps = dependencies(db);

    await createScheduledHandler(deps)({ cron: ANONYMOUS_SESSIONS_CRON }, ENV);

    expect(ANONYMOUS_SESSIONS_CRON).toBe("37 18 * * *");
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the agent-domain DSN is absent", async () => {
    const deps = dependencies(database());

    await expect(createScheduledHandler(deps)({ cron: ANON_QUOTA_CRON }, {})).rejects.toThrow(
      "Missing required binding: AGENT_DATABASE_URL",
    );
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it("fails an unknown cron instead of silently running the wrong purge", async () => {
    const deps = dependencies(database());

    await expect(createScheduledHandler(deps)({ cron: "0 0 * * *" }, ENV)).rejects.toThrow(
      "Unknown maintenance cron: 0 0 * * *",
    );
  });
});
