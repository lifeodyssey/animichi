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

/** 200s whose `adopted` is missing, a string, fractional, or negative: an
 * invalid Agent or Edge response, never a silent ownership transfer
 * (SESSION-2 #960). */
const INVALID_RESPONSES: [string, Record<string, unknown>][] = [
  ["an empty object", {}],
  ["a string-valued adopted", { adopted: "0", noop_class: "no_rows" }],
  ["a fractional adopted", { adopted: 0.5, noop_class: "no_rows" }],
  ["a negative adopted", { adopted: -1, noop_class: "no_rows" }],
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

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

  it("is safe to repeat: the second call is issued and the server no-ops it", async () => {
    server.use(
      http.post(URL, () => HttpResponse.json({ adopted: 1, noop_class: "adopted" }), { once: true }),
      http.post(URL, () => HttpResponse.json({ adopted: 0, noop_class: "no_rows" })),
    );
    expect(await adoptSessions("jwt-1", BASE)).toBe("adopted");
    expect(await adoptSessions("jwt-1", BASE)).toBe("nothing");
  });
});

describe("adoptSessions invalid responses", () => {
  it.each(INVALID_RESPONSES)("treats %s as an invalid response, not a silent adoption", async (_label, body) => {
    server.use(http.post(URL, () => HttpResponse.json(body)));
    expect(await adoptSessions("jwt-1", BASE)).toBe("failed");
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

  it("reports `failed` for a 200 whose JSON body is not an object", async () => {
    // A parseable but non-object body (a JSON string or null) never carries an
    // ownership transfer, so it is an invalid Agent/Edge response too.
    server.use(http.post(URL, () => HttpResponse.json("no_rows")));
    await expect(adoptSessions("jwt-1", BASE)).resolves.toBe("failed");
    server.use(http.post(URL, () => HttpResponse.json(null)));
    await expect(adoptSessions("jwt-1", BASE)).resolves.toBe("failed");
  });
});

describe("adoptSessions default base URL", () => {
  it("resolves the agent origin from window.location when the browser provides it", async () => {
    // No `baseUrl` argument: the origin is `window.location.origin`, the same
    // origin whose cookie jar holds `aid` (the edge forwards it as
    // `X-Anon-Id` on this route alone).
    const seen: Seen[] = [];
    server.use(
      http.post("http://localhost:3000/v1/sessions/adopt", async ({ request }) => {
        seen.push({
          method: request.method,
          authorization: request.headers.get("authorization"),
          credentials: request.credentials,
          body: await request.text(),
          keepalive: request.keepalive,
        });
        return HttpResponse.json({ adopted: 1, noop_class: "adopted" });
      }),
    );
    expect(await adoptSessions("jwt-1")).toBe("adopted");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBe("Bearer jwt-1");
  });

  it("falls back to VITE_AGENT_URL when no window exists (SSR)", async () => {
    // The `aid` cookie only exists in a browser, but the SSR base URL must
    // still resolve deterministically instead of touching a missing window.
    vi.stubGlobal("window", undefined);
    vi.stubEnv("VITE_AGENT_URL", "http://agent.test");
    server.use(
      http.post("http://agent.test/v1/sessions/adopt", () =>
        HttpResponse.json({ adopted: 0, noop_class: "no_rows" })),
    );
    expect(await adoptSessions("jwt-1")).toBe("nothing");
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

  it("converges a no-op after a prior timeout instead of flagging it", () => {
    // SESSION-2 #960: the first attempt timed out, the retry observes the
    // late-landed adoption as 0 rows — that is success, not an anomaly.
    expect(anomalyOf("nothing", true, true)).toBeUndefined();
    expect(anomalyOf("nothing", false, true)).toBeUndefined();
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
