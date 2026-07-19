import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type FetchListener = (event: FetchEventLike) => void;

interface FetchEventLike {
  request: RequestLike;
  respondWith: ReturnType<typeof vi.fn>;
}

interface RequestLike {
  url: string;
  mode: string;
}

const listeners = new Map<string, (event: never) => void>();
const cache = { put: vi.fn(), match: vi.fn() };
const fetchMock = vi.fn();

function fetchListener(): FetchListener {
  const listener = listeners.get("fetch");
  if (!listener) throw new Error("fetch listener not registered");
  return listener as FetchListener;
}

function dispatchFetch(request: RequestLike): FetchEventLike {
  const event: FetchEventLike = { request, respondWith: vi.fn() };
  fetchListener()(event);
  return event;
}

const animeRequest: RequestLike = { url: "https://animichi.example/anime/123", mode: "navigate" };

beforeAll(async () => {
  vi.stubGlobal("addEventListener", (type: string, listener: (event: never) => void) => {
    listeners.set(type, listener);
  });
  vi.stubGlobal("caches", { open: vi.fn(() => Promise.resolve(cache)) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("skipWaiting", vi.fn());
  vi.stubGlobal("clients", { claim: vi.fn(() => Promise.resolve()) });
  await import("../../../public/sw.js");
});

beforeEach(() => {
  cache.put.mockReset();
  cache.match.mockReset();
  fetchMock.mockReset();
});

describe("sw.js registration surface", () => {
  it("listens for install, activate, and fetch", () => {
    expect([...listeners.keys()]).toEqual(expect.arrayContaining(["install", "activate", "fetch"]));
  });
});

describe("sw.js network-first for /anime navigations", () => {
  it("serves the fresh network response and refreshes the cache (never stale)", async () => {
    const fresh = new Response("fresh html");
    fetchMock.mockResolvedValue(fresh);
    const event = dispatchFetch(animeRequest);
    const respondArg: unknown = event.respondWith.mock.calls[0]?.[0];
    await expect(respondArg).resolves.toBe(fresh);
    expect(cache.put).toHaveBeenCalledWith(animeRequest, expect.any(Response));
  });

  it("falls back to the cached copy only when the network fails", async () => {
    const cached = new Response("cached html");
    fetchMock.mockRejectedValue(new Error("offline"));
    cache.match.mockResolvedValue(cached);
    const event = dispatchFetch(animeRequest);
    const respondArg: unknown = event.respondWith.mock.calls[0]?.[0];
    await expect(respondArg).resolves.toBe(cached);
  });

  it("propagates the network error when nothing is cached", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    cache.match.mockResolvedValue(undefined);
    const event = dispatchFetch(animeRequest);
    const respondArg: unknown = event.respondWith.mock.calls[0]?.[0];
    await expect(respondArg).rejects.toThrow("offline");
  });
});

describe("sw.js scope", () => {
  it("ignores non-navigation requests under /anime", () => {
    const event = dispatchFetch({ url: "https://animichi.example/anime/123", mode: "cors" });
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("ignores navigations outside /anime", () => {
    const event = dispatchFetch({ url: "https://animichi.example/chat", mode: "navigate" });
    expect(event.respondWith).not.toHaveBeenCalled();
  });
});
