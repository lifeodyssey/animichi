import pg from "pg";
import { expect, it, onTestFinished } from "vitest";
import { databaseDescribe, directPoolConfig, planeDatabaseUrl } from "./integration-db";
import { LOOPBACK_ANSWER, startLoopbackServer } from "./loopback-server";

/**
 * The container lane's global `fetch` (`test/setup/loopback-only-fetch.ts`,
 * loaded by `vitest.integration.config.ts`): a request to a host other than
 * loopback is refused before anything is sent, even in a run whose
 * `NODE_USE_ENV_PROXY=1` would hand it to the machine's proxy, while a loopback
 * server the test starts and the suite database, which `pg` reaches over its
 * own socket, both still answer.
 *
 * The probe host is under `.invalid`, a name reserved never to resolve
 * (RFC 2606).
 */
const PROBE = "https://outbound-guard.invalid/probe?case=container-lane";

databaseDescribe("the container lane's fetch, loopback only", () => {
  it("refuses an unstubbed request to a host that is not loopback, naming it", async () => {
    await expect(fetch(PROBE)).rejects.toThrow(`node test pool refused an outbound request: GET ${PROBE}`);
  });

  it("lets a loopback server the test started answer", async () => {
    const server = await startLoopbackServer();
    onTestFinished(() => server.close());

    const response = await fetch(server.url);

    expect(await response.text()).toBe(LOOPBACK_ANSWER);
  });

  it("leaves the suite database reachable over pg's own socket", async () => {
    const pool = new pg.Pool(directPoolConfig(planeDatabaseUrl()));
    onTestFinished(() => pool.end());

    const { rows } = await pool.query<{ answer: number }>("SELECT 1 AS answer");

    expect(rows).toEqual([{ answer: 1 }]);
  });
});
