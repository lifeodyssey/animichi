/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { IDEMPOTENCY_KEY_HEADER, type SaveSavedRouteInput } from "@animichi/contract";
import { classifySaveFailure, idempotencyKeyFor, saveSavedRouteRequest, useSavedRoute } from "../../../src/api/hooks/use-saved-route";
import { server } from "../../msw/node";
import { USERS_SAVED_ROUTES_URL, usersSaveSavedRouteHandler, usersSaveSavedRouteOutageHandler } from "../../msw/users";

const INPUT: SaveSavedRouteInput = { title: "宇治・3スポットの聖地巡礼", point_ids: ["p1", "p2", "p3"], status: "saved" };

describe("saveSavedRouteRequest goes through the contract-typed users client", () => {
  it("persists the point ids in order and returns the saved row", async () => {
    server.use(usersSaveSavedRouteHandler);
    const route = await saveSavedRouteRequest(INPUT);
    expect(route.point_ids).toEqual(["p1", "p2", "p3"]);
    expect(route.title).toBe(INPUT.title);
    expect(route.status).toBe("saved");
  });

  it("surfaces a users-service outage as a rejection the card can retry", async () => {
    server.use(usersSaveSavedRouteOutageHandler);
    await expect(saveSavedRouteRequest(INPUT)).rejects.toThrow();
  });
});

describe("P1-1: concurrent saves collapse to one request", () => {
  it("drops a second save issued before the first settles", async () => {
    let release = (): void => undefined;
    const request = vi.fn().mockImplementation(() => new Promise((resolve) => { release = () => { resolve(INPUT); }; }));
    const { result } = renderHook(() => useSavedRoute(request));
    const first = result.current.save(INPUT);
    const second = result.current.save(INPUT);
    release();
    await Promise.all([first, second]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("failure classification decides retry vs re-wall", () => {
  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [422, "permanent"],
    [404, "permanent"],
    [429, "retryable"],
    [408, "retryable"],
    [503, "retryable"],
  ] as const)("maps %i to %s", (status, expected) => {
    expect(classifySaveFailure({ status })).toBe(expected);
  });

  it("treats a transport error with no status as retryable", () => {
    expect(classifySaveFailure(new Error("network"))).toBe("retryable");
  });
});

describe("a saved route refreshes the caller's route list", () => {
  it("invalidates the users.listSavedRoutes query when a provider is present", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: Readonly<{ children: ReactNode }>) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useSavedRoute(vi.fn().mockResolvedValue(INPUT)), { wrapper });
    await act(async () => { await result.current.save(INPUT); });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("saves fine with no provider at all — a bare card render must not throw", async () => {
    const { result } = renderHook(() => useSavedRoute(vi.fn().mockResolvedValue(INPUT)));
    await act(async () => { expect(await result.current.save(INPUT)).toBe("saved"); });
  });
});

describe("AC6: idempotent create keys keep one visible SavedRoute (issue #1011)", () => {
  it("derives a stable, bounded key from the create payload", () => {
    const key = idempotencyKeyFor(INPUT);
    expect(key.length).toBeGreaterThan(0);
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it("the same payload yields the same key across a reload and tabs", () => {
    expect(idempotencyKeyFor(INPUT)).toBe(idempotencyKeyFor(INPUT));
    expect(idempotencyKeyFor({ ...INPUT, title: "同し" })).toBe(idempotencyKeyFor({ ...INPUT, title: "同し" }));
  });

  it("a different payload yields a different key", () => {
    expect(idempotencyKeyFor(INPUT)).not.toBe(idempotencyKeyFor({ ...INPUT, point_ids: ["p9"] }));
  });

  it("saveSavedRouteRequest sends the payload-derived Idempotency-Key header", async () => {
    const seen: string[] = [];
    server.use(http.post(USERS_SAVED_ROUTES_URL, ({ request }) => {
      seen.push(request.headers.get(IDEMPOTENCY_KEY_HEADER) ?? "");
      return HttpResponse.json({ id: "r-ac6", title: INPUT.title, point_ids: INPUT.point_ids, status: "saved", saved_at: null, updated_at: "" });
    }));
    await saveSavedRouteRequest(INPUT);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(idempotencyKeyFor(INPUT));
  });

  it("a retry sends the SAME key, so the server dedupes (reload/double-click/multi-tab)", async () => {
    const seen: string[] = [];
    server.use(http.post(USERS_SAVED_ROUTES_URL, ({ request }) => {
      seen.push(request.headers.get(IDEMPOTENCY_KEY_HEADER) ?? "");
      return HttpResponse.json({ id: "r-ac6", title: INPUT.title, point_ids: INPUT.point_ids, status: "saved", saved_at: null, updated_at: "" });
    }));
    await saveSavedRouteRequest(INPUT);
    await saveSavedRouteRequest(INPUT);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
