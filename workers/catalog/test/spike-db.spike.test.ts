import { neonConfig } from "@neondatabase/serverless";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_TABLES,
  captureNeonConfig,
  catalogTruncateSql,
  directPoolConfig,
  restoreNeonConfig,
} from "./spike-db";
import {
  findEphemeralBranch,
  type NeonBranch,
  verifyTestBase,
} from "./spike-db-global";

const suiteSnapshot = captureNeonConfig();
const parent: NeonBranch = {
  id: "br-test-base",
  name: "test-base",
  projectId: "project-1",
  parentId: "br-main",
  default: false,
};

afterEach(() => {
  restoreNeonConfig(suiteSnapshot);
});

describe("spike database helper", () => {
  it("builds the exact no-CASCADE FK-closed TRUNCATE statement", () => {
    const statement = catalogTruncateSql();

    expect(CATALOG_TABLES).toHaveLength(12);
    expect(statement).toContain('"route_anime"');
    expect(statement).not.toMatch(/CASCADE/u);
    expect(statement).not.toMatch(/locations|location_aliases|atlas_schema_revisions/u);
    expect(statement).toMatch(/RESTART IDENTITY$/u);
  });

  it("snapshots and restores all three process-global neonConfig values", () => {
    const snapshot = captureNeonConfig();
    neonConfig.fetchEndpoint = "http://127.0.0.1:1/sql";
    neonConfig.poolQueryViaFetch = !snapshot.poolQueryViaFetch;
    neonConfig.useSecureWebSocket = !snapshot.useSecureWebSocket;

    restoreNeonConfig(snapshot);

    expect(captureNeonConfig()).toEqual(snapshot);
  });

  it("leaves direct-cloud TLS behavior to the connection URI", () => {
    const config = directPoolConfig("postgresql://cloud.example/neondb?sslmode=require");

    expect(config.connectionTimeoutMillis).toBe(10_000);
    expect(config).not.toHaveProperty("ssl");
  });

  it("name-on-id verifies the unique test-base branch", () => {
    expect(verifyTestBase([parent], { ...parent }, "project-1")).toEqual(parent);
    expect(() => verifyTestBase([parent], { ...parent, name: "staging" }, "project-1"))
      .toThrow(/name-on-id/u);
  });

  it("resolves only the new branch parented to test-base", () => {
    const unrelated = { ...parent, id: "br-other", name: "preview/42" };
    const ephemeral = { ...parent, id: "br-ephemeral", name: "br-random", parentId: parent.id };

    expect(findEphemeralBranch([parent], [parent, unrelated, ephemeral], parent))
      .toEqual(ephemeral);
  });
});
