import { expect, it } from "vitest";

/**
 * The worker test pool (`vitest.config.ts`) refuses every outbound fetch a test
 * did not stub, so no worker test can fetch from a real host (root
 * `AGENTS.md`). On 2026-11-14 a worker test called the global `fetch` before it
 * stubbed it, and the pool sent one request to api.bgm.tv and up to three to
 * the deployed egress service.
 *
 * The probe host is under `.invalid`, a name reserved never to resolve
 * (RFC 2606): without the guard this fetch fails on name resolution, so nothing
 * can leave the machine either way.
 */
const PROBE = "https://outbound-guard.invalid/probe?case=unstubbed";

it.each([
  { method: "GET", body: undefined },
  { method: "POST", body: JSON.stringify({ keyword: "probe" }) },
])("answers an unstubbed $method with the pool's refusal, naming the request", async ({ method, body }) => {
  const response = await fetch(PROBE, { method, body });

  expect(response.status).toBe(500);
  await expect(response.text()).resolves.toContain(`refused an outbound request: ${method} ${PROBE}`);
});
