/**
 * @vitest-environment jsdom
 */
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { runByokProbe } from "../../../src/features/chat/byok-probe";
import { saveByokConfig } from "../../../src/lib/byok/byokStorage";
import { server } from "../../msw/node";

const BASE = "http://agent.test";
const PROBE = `${BASE}/v1/byok/probe`;

function stubProbe(status: number, body: unknown): void {
  server.use(http.post(PROBE, () => HttpResponse.json(body as Record<string, unknown>, { status })));
}

afterEach(() => {
  sessionStorage.clear();
});

describe("runByokProbe — spec response shape (Task 5 contract)", () => {
  it("maps a reachable vision-capable provider to a definitive ok/vision:true", async () => {
    stubProbe(200, { vision: true, reachable: true, error_code: null });
    expect(await runByokProbe(BASE)).toEqual({ kind: "ok", vision: true, definitive: true });
  });

  it("maps a clean image-part rejection to a definitive ok/vision:false", async () => {
    stubProbe(200, { vision: false, reachable: true, error_code: null });
    expect(await runByokProbe(BASE)).toEqual({ kind: "ok", vision: false, definitive: true });
  });

  it("treats vision:false with ANY error_code as non-definitive (#479 P2-1)", async () => {
    stubProbe(200, { vision: false, reachable: true, error_code: "rate_limited" });
    expect(await runByokProbe(BASE)).toEqual({ kind: "ok", vision: false, definitive: false });
  });

  it("tolerates a future unknown error_code on an unreachable result (no exhaustive switch)", async () => {
    stubProbe(200, { vision: false, reachable: false, error_code: "some_future_code" });
    expect(await runByokProbe(BASE)).toEqual({ kind: "unreachable" });
  });

  it("maps a rejected credential (reachable:false + typed code) to rejected", async () => {
    stubProbe(200, { vision: false, reachable: false, error_code: "byok_credential_rejected" });
    expect(await runByokProbe(BASE)).toEqual({ kind: "rejected" });
  });

  it("maps the collapsed unreachable taxonomy to unreachable", async () => {
    stubProbe(200, { vision: false, reachable: false, error_code: "provider_unreachable" });
    expect(await runByokProbe(BASE)).toEqual({ kind: "unreachable" });
  });
});

describe("runByokProbe — HTTP failure taxonomy", () => {
  it("maps a 400 egress_blocked to invalid with its code", async () => {
    stubProbe(400, { error: { code: "egress_blocked" } });
    expect(await runByokProbe(BASE)).toEqual({ kind: "invalid", code: "egress_blocked" });
  });

  it("maps a 400 invalid_request to invalid with its code", async () => {
    stubProbe(400, { error: { code: "invalid_request" } });
    expect(await runByokProbe(BASE)).toEqual({ kind: "invalid", code: "invalid_request" });
  });

  it("maps an edge 401 to requires_login", async () => {
    stubProbe(401, { error: { code: "unauthorized" } });
    expect(await runByokProbe(BASE)).toEqual({ kind: "requires_login" });
  });

  it("maps a 403 byok_requires_login to requires_login", async () => {
    stubProbe(403, { error: { code: "byok_requires_login" } });
    expect(await runByokProbe(BASE)).toEqual({ kind: "requires_login" });
  });

  it("maps a 403 byok_credential_rejected to rejected", async () => {
    stubProbe(403, { error: { code: "byok_credential_rejected" } });
    expect(await runByokProbe(BASE)).toEqual({ kind: "rejected" });
  });

  it("maps a malformed 200 body to error rather than crashing", async () => {
    stubProbe(200, { nonsense: true });
    expect(await runByokProbe(BASE)).toEqual({ kind: "error" });
  });

  it("maps an unexpected 5xx to error", async () => {
    stubProbe(500, { error: { code: "internal_error" } });
    expect(await runByokProbe(BASE)).toEqual({ kind: "error" });
  });

  it("maps a network failure to error", async () => {
    server.use(http.post(PROBE, () => HttpResponse.error()));
    expect(await runByokProbe(BASE)).toEqual({ kind: "error" });
  });
});

describe("runByokProbe — request identity", () => {
  it("sends the saved X-BYOK-* headers with the probe", async () => {
    saveByokConfig({ provider: "anthropic", apiKey: "sk-probe-test", model: "claude-sonnet-4-5" });
    let seen: Headers | undefined;
    server.use(http.post(PROBE, ({ request }) => {
      seen = request.headers;
      return HttpResponse.json({ vision: true, reachable: true, error_code: null });
    }));
    await runByokProbe(BASE);
    expect(seen?.get("X-BYOK-Provider")).toBe("anthropic");
    expect(seen?.get("X-BYOK-Key")).toBe("sk-probe-test");
    expect(seen?.get("X-BYOK-Model")).toBe("claude-sonnet-4-5");
  });
});
