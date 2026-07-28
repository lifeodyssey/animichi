/**
 * @vitest-environment jsdom
 *
 * AC3 (create-on-login): after a magic-link login initiated by the save tap, the
 * deferred intent replays through `users.saveRoute` and the persisted row is
 * visible to `users.listRoutes`. Asserted on row content, not on the call having
 * been made — a fake that merely records the request would pass the weaker form.
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { JsonBodyType } from "msw";
import { ListRoutesResult, SaveRouteInput, UserRoute } from "@seichijunrei/contract";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "../../src/api/orpc";
import { replayDeferredSave } from "../../src/features/chat/save/createOnLogin";
import { writeDeferredSave } from "../../src/features/chat/save/deferredSave";

const ROUTES_URL = "http://localhost:3000/v1/users/routes";
const POINT_IDS = ["uji-01", "uji-02", "uji-03"];
const TITLE = "響け!ユーフォニアム・3スポットの聖地巡礼";

/** A stateful stand-in for the users Worker: saves persist and then list. */
const saved: UserRoute[] = [];

const server = setupServer(
  http.post(ROUTES_URL, async ({ request }) => {
    const input = SaveRouteInput.parse(await request.json());
    const row = UserRoute.parse({
      id: `11111111-1111-4111-8111-00000000000${String(saved.length)}`,
      title: input.title,
      point_ids: input.point_ids,
      status: input.status,
      saved_at: "2026-07-28T00:00:00.000Z",
      updated_at: "2026-07-28T00:00:00.000Z",
    });
    saved.push(row);
    return HttpResponse.json(row);
  }),
  http.get(ROUTES_URL, () => HttpResponse.json(ListRoutesResult.parse({ routes: saved }) as JsonBodyType)),
);

beforeAll(() => { server.listen({ onUnhandledRequest: "error" }); });
afterEach(() => { server.resetHandlers(); });
afterAll(() => { server.close(); });

beforeEach(() => {
  saved.length = 0;
  localStorage.clear();
});

describe("create-on-login persists the deferred route and lists it back", () => {
  it("writes a row whose point_ids are the deferred ids, in order and non-empty", async () => {
    writeDeferredSave({ pointIds: POINT_IDS, title: TITLE });
    expect(await replayDeferredSave()).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.point_ids).toEqual(POINT_IDS);
    expect(saved[0]?.point_ids.length).toBeGreaterThan(0);
    expect(saved[0]?.title).toBe(TITLE);
    expect(saved[0]?.status).toBe("saved");
  });

  it("makes the new row visible to a subsequent listRoutes for that user", async () => {
    writeDeferredSave({ pointIds: POINT_IDS, title: TITLE });
    await replayDeferredSave();
    const listed = await users().listRoutes.call();
    expect(listed.routes.map((route) => route.title)).toContain(TITLE);
    expect(listed.routes[0]?.point_ids).toEqual(POINT_IDS);
  });

  it("creates rather than claims: no route id is ever sent, so ownership cannot be contested", async () => {
    let sentId: unknown = "unset";
    server.use(
      http.post(ROUTES_URL, async ({ request }) => {
        sentId = (await request.json() as Record<string, unknown>).id;
        return HttpResponse.json(UserRoute.parse({
          id: "22222222-2222-4222-8222-222222222222",
          title: TITLE,
          point_ids: POINT_IDS,
          status: "saved",
          saved_at: null,
          updated_at: "2026-07-28T00:00:00.000Z",
        }));
      }),
    );
    writeDeferredSave({ pointIds: POINT_IDS, title: TITLE });
    await replayDeferredSave();
    expect(sentId).toBeUndefined();
  });

  it("does not fire at all for a login that no save tap initiated", async () => {
    expect(await replayDeferredSave()).toBe(false);
    expect(saved).toHaveLength(0);
  });
});
