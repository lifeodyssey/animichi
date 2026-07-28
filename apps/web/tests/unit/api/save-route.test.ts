/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { SaveRouteInput } from "@seichijunrei/contract";
import { saveRouteRequest } from "../../../src/api/hooks/use-save-route";
import { server } from "../../msw/node";
import { usersSaveRouteHandler, usersSaveRouteOutageHandler } from "../../msw/users";

const INPUT: SaveRouteInput = { title: "宇治・3スポットの聖地巡礼", point_ids: ["p1", "p2", "p3"], status: "saved" };

describe("saveRouteRequest goes through the contract-typed users client", () => {
  it("persists the point ids in order and returns the saved row", async () => {
    server.use(usersSaveRouteHandler);
    const route = await saveRouteRequest(INPUT);
    expect(route.point_ids).toEqual(["p1", "p2", "p3"]);
    expect(route.title).toBe(INPUT.title);
    expect(route.status).toBe("saved");
  });

  it("surfaces a users-service outage as a rejection the card can retry", async () => {
    server.use(usersSaveRouteOutageHandler);
    await expect(saveRouteRequest(INPUT)).rejects.toThrow();
  });
});
