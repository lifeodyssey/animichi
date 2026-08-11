/**
 * @vitest-environment jsdom
 */
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../msw/node";
import {
  SESSION_ADOPT_PATH,
  adoptSessions,
  anomalyOf,
  reportAdoptionAnomaly,
} from "../../../src/lib/auth/session-adoption";

const BASE = "http://edge.test";
const URL = `${BASE}${SESSION_ADOPT_PATH}`;

interface Seen {
  method: string;
  authorization: string | null;
  credentials: string;
  body: string;
  keepalive: boolean;
}

function capture(sink: Seen[], adopted = 1) {
  return http.post(URL, async ({ request }) => {
    sink.push({
      method: request.method,
      authorization: request.headers.get("authorization"),
      credentials: request.credentials,
      body: await request.text(),
      keepalive: request.keepalive,
    });
    return HttpResponse.json({ adopted, noop_class: "adopted" });
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe("adoptSessions", () => {
  it("POSTs the bearer token to /v1/sessions/adopt with no body at all", async () => {
    const seen: Seen[] = [];
    server.use(capture(seen));
    expect(await adoptSessions("jwt-1", BASE)).toBe("adopted");
    expect(seen).toEqual([
      { method: "POST", authorization: "Bearer jwt-1", credentials: "include", body: "", keepalive: true },
    ]);
  });

  it("sends credentials so the HttpOnly `aid` cookie can reach the edge", async () => {
    const seen: Seen[] = [];
    server.use(capture(seen));
    await adoptSessions("jwt-1", BASE);
    // The client cannot name the anonymous identity: `aid` is HttpOnly. Losing
    // this option would adopt nothing while still returning 200.
    expect(seen[0]?.credentials).toBe("include");
  });

  it("keeps the request alive past a navigation away from the callback screen", async () => {
    const seen: Seen[] = [];
    server.use(capture(seen));
    await adoptSessions("jwt-1", BASE);
    expect(seen[0]?.keepalive).toBe(true);
  });

  it("distinguishes the typed no-op from an actual adoption", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ adopted: 0, noop_class: "no_rows" })));
    expect(await adoptSessions("jwt-1", BASE)).toBe("nothing");
  });

  it("reports `failed` on a non-2xx (a 403 from the reject-anonymous predicate)", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ error: "forbidden" }, { status: 403 })));
    expect(await adoptSessions("jwt-1", BASE)).toBe("failed");
  });

  it("reports `failed` rather than throwing when the request never lands", async () => {
    server.use(http.post(URL, () => HttpResponse.error()));
    await expect(adoptSessions("jwt-1", BASE)).resolves.toBe("failed");
  });

  it("reports `failed` rather than throwing on an unparseable body", async () => {
    server.use(http.post(URL, () => new HttpResponse("not json", { status: 200 })));
    await expect(adoptSessions("jwt-1", BASE)).resolves.toBe("failed");
  });

  it("is safe to repeat: the second call is issued and the server no-ops it", async () => {
    let calls = 0;
    server.use(http.post(URL, () => HttpResponse.json({ adopted: ++calls === 1 ? 1 : 0, noop_class: "no_rows" })));
    expect(await adoptSessions("jwt-1", BASE)).toBe("adopted");
    expect(await adoptSessions("jwt-1", BASE)).toBe("nothing");
  });
});

describe("anomalyOf", () => {
  it("treats a failure as an anomaly regardless of expectation", () => {
    expect(anomalyOf("failed", false)).toBe("failed");
    expect(anomalyOf("failed", true)).toBe("failed");
  });

  it("flags a no-op ONLY when the login's target named a session", () => {
    // The cross-device magic link: `next` carries the session, `aid` does not
    // travel, so 0 rows move and the mismatch is the only available signal.
    expect(anomalyOf("nothing", true)).toBe("nothing-adopted");
    expect(anomalyOf("nothing", false)).toBeUndefined();
  });

  it("never flags an adoption that moved rows", () => {
    expect(anomalyOf("adopted", true)).toBeUndefined();
    expect(anomalyOf("adopted", false)).toBeUndefined();
  });
});

describe("reportAdoptionAnomaly", () => {
  it("emits one structured, credential-free record naming the anomaly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportAdoptionAnomaly("nothing-adopted");
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: "auth_session_adoption", anomaly: "nothing-adopted" }),
    );
  });
});
