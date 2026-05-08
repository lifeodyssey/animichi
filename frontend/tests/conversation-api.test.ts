import { it, expect, beforeAll } from "vitest";
import type { RuntimeResponse } from "../lib/types";

// Set env vars before any module that reads them is imported
process.env.NEXT_PUBLIC_RUNTIME_URL = "https://runtime.example";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

let api: typeof import("../lib/api");
let supabase: NonNullable<ReturnType<typeof import("../lib/supabase/browser").createClient>>;

beforeAll(async () => {
  api = await import("../lib/api");
  const { createClient } = await import("../lib/supabase/browser");
  supabase = createClient()!;
});

function setAccessToken(token: string | null) {
  Object.defineProperty(supabase.auth, "getSession", {
    configurable: true,
    value: async () => ({
      data: {
        session: token ? { access_token: token } : null,
      },
    }),
  });
}

function buildRuntimeResponse(overrides: Partial<RuntimeResponse> = {}): RuntimeResponse {
  return {
    success: true,
    status: "ok",
    intent: "search_nearby",
    session_id: "sess-stream",
    message: "Done",
    data: {
      results: {
        rows: [],
        row_count: 0,
        strategy: "geo",
        status: "empty",
      },
      message: "Done",
      status: "empty",
    },
    session: {
      interaction_count: 1,
      route_history_count: 0,
    },
    route_history: [],
    errors: [],
    ...overrides,
  };
}

it("fetchConversations returns an empty list when the user is unauthenticated", async () => {
  setAccessToken(null);
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  }) as typeof fetch;

  const records = await api.fetchConversations();

  expect(records).toEqual([]);
  expect(fetchCalled).toBe(false);
});

it("fetchConversations sends an authorized GET request", async () => {
  setAccessToken("token-123");
  const payload = [
    {
      session_id: "sess-1",
      title: "宇治巡礼",
      first_query: "宇治の聖地を探して",
      created_at: "2026-04-02T00:00:00.000Z",
      updated_at: "2026-04-02T01:00:00.000Z",
    },
  ];
  let fetchArgs: Parameters<typeof fetch> | null = null;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchArgs = args;
    return {
      ok: true,
      json: async () => payload,
    } as Response;
  }) as typeof fetch;

  const records = await api.fetchConversations();

  expect(records).toEqual(payload);
  expect(fetchArgs?.[0]).toBe("https://runtime.example/v1/conversations");
  expect(fetchArgs?.[1]).toEqual({
    headers: {
      Authorization: "Bearer token-123",
    },
  });
});

it("patchConversationTitle encodes the session id and sends the title", async () => {
  setAccessToken("token-123");
  let fetchArgs: Parameters<typeof fetch> | null = null;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchArgs = args;
    return {
      ok: true,
    } as Response;
  }) as typeof fetch;

  await api.patchConversationTitle("sess/1", "  宇治  ");

  expect(fetchArgs?.[0]).toBe(
    "https://runtime.example/v1/conversations/sess%2F1",
  );
  expect(fetchArgs?.[1]).toEqual({
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token-123",
    },
    body: JSON.stringify({ title: "  宇治  " }),
  });
});

it("patchConversationTitle throws when the rename request fails", async () => {
  setAccessToken("token-123");
  global.fetch = (async () =>
    ({
      ok: false,
      status: 500,
    }) as Response) as typeof fetch;

  await expect(
    () => api.patchConversationTitle("sess-1", "宇治"),
  ).rejects.toThrow(/Rename failed \(500\)/);
});

it("sendSelectedRoute posts selected ids, origin, locale, and auth", async () => {
  setAccessToken("token-123");
  const response = buildRuntimeResponse({
    intent: "plan_selected",
    message: "Created a route with 2 selected stops.",
  });
  let fetchArgs: Parameters<typeof fetch> | null = null;

  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchArgs = args;
    return {
      ok: true,
      json: async () => response,
    } as Response;
  }) as typeof fetch;

  const result = await api.sendSelectedRoute(
    ["point-1", "point-2"],
    "Uji Station",
    "sess-selected",
    "en",
  );

  expect(result).toEqual(response);
  expect(fetchArgs?.[0]).toBe("https://runtime.example/v1/runtime");
  const requestInit = fetchArgs?.[1] as RequestInit | undefined;
  expect(requestInit?.method).toBe("POST");
  expect(requestInit?.headers).toEqual({
    "Content-Type": "application/json",
    Authorization: "Bearer token-123",
  });
  expect(JSON.parse(String(requestInit?.body))).toEqual({
    text: "Create a route with 2 selected stops from Uji Station.",
    session_id: "sess-selected",
    locale: "en",
    selected_point_ids: ["point-1", "point-2"],
    origin: "Uji Station",
  });
});
