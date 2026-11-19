import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { LOOPBACK_ANSWER, startLoopbackServer } from "./loopback-server";

/**
 * The plain-Node lane's global `fetch` (`test/setup/loopback-only-fetch.ts`,
 * loaded by `vitest.node.config.ts`): a request to a host other than loopback
 * is refused before anything is sent, naming the request, so no Node test can
 * fetch from a real host (root `AGENTS.md`); a loopback server the test starts
 * still answers; and a test that unstubs or restores its own `fetch` double
 * gets the refusal back, not the network.
 *
 * The probe host is under `.invalid`, a name reserved never to resolve
 * (RFC 2606): without the guard this fetch fails on name resolution, so nothing
 * can leave the machine either way.
 */
const PROBE = "https://outbound-guard.invalid/probe?case=node-lane";
const REFUSAL = "node test pool refused an outbound request";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  { method: "GET", body: undefined },
  { method: "POST", body: JSON.stringify({ keyword: "probe" }) },
])("refuses an unstubbed $method to a host that is not loopback, logging and naming it", async ({ method, body }) => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

  await expect(fetch(PROBE, { method, body })).rejects.toThrow(`${REFUSAL}: ${method} ${PROBE}`);
  expect(logged).toHaveBeenCalledExactlyOnceWith(`${REFUSAL}: ${method} ${PROBE} (stub fetch in the test)`);
});

it("lets a loopback server the test started answer", async () => {
  const server = await startLoopbackServer();
  onTestFinished(() => server.close());

  const response = await fetch(server.url);

  expect(await response.text()).toBe(LOOPBACK_ANSWER);
});

it("refuses again once a test unstubs its own fetch", async () => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("stubbed")));
  vi.unstubAllGlobals();

  await expect(fetch(PROBE)).rejects.toThrow(`${REFUSAL}: GET ${PROBE}`);
});

it("refuses again once a test restores its fetch spy", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("spied"));
  vi.restoreAllMocks();

  await expect(fetch(PROBE)).rejects.toThrow(`${REFUSAL}: GET ${PROBE}`);
});
