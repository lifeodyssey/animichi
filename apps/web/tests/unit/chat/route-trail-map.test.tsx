/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteTrailMap } from "../../../src/features/chat/components/RouteTrailMap";
import type { AttachBasemap } from "../../../src/features/chat/components/SearchMap";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { pointPlacements } from "../../../src/features/bubble-map/bubbleGeometry";
import type { LocatedSpot } from "../../../src/lib/chat/spotClusters";
import { ruleDeclaration } from "../_token-helpers";
import chatCss from "../../../src/styles/chat.css?raw";

afterEach(cleanup);

const dict = chatDictFor("ja");
const attachReady: AttachBasemap = ({ onStatus }) => {
  onStatus("ready");
  return () => undefined;
};
const attachFailing: AttachBasemap = ({ onStatus }) => {
  onStatus("fallback");
  return () => undefined;
};

function spot(id: string, name: string, lat: number, lng: number): LocatedSpot {
  return { id, name, coord: { lat, lng } };
}

const STATIONS = [spot("a", "宇治橋", 34.891, 135.807), spot("b", "京阪宇治駅", 34.911, 135.806), spot("c", "宇治神社", 34.9, 135.81)];
const OFF_ROUTE = [spot("x", "平等院", 34.889, 135.808)];

function renderTrail(attach: AttachBasemap = attachReady) {
  return render(<RouteTrailMap stations={STATIONS} dimmed={OFF_ROUTE} dict={dict} attach={attach} />);
}

describe("AC2: map promotion after route generation", () => {
  it("draws one track polyline through every route station", () => {
    renderTrail();
    const line = document.querySelector(".chat-route-map__line");
    expect(line?.getAttribute("points")?.split(" ")).toHaveLength(3);
  });

  it("renumbers pins in walking order", () => {
    renderTrail();
    const pins = [...document.querySelectorAll(".chat-route-pin")];
    expect(pins.map((pin) => pin.textContent)).toEqual(["1", "2", "3"]);
  });

  // Labels alone do not pin the ordering: reversing the placements keeps the
  // labels "1","2","3" present and leaves the polyline shape identical, so the
  // assertion above survives that mutation. Bind each label to the position its
  // station actually projects to.
  it("puts pin N at station N's own position, not merely somewhere on the map", () => {
    renderTrail();
    const expected = pointPlacements([...STATIONS, ...OFF_ROUTE].map((s) => s.coord));
    const pins = [...document.querySelectorAll<HTMLElement>(".chat-route-pin")];
    const actual = pins.map((pin) => [pin.style.left, pin.style.top]);
    expect(actual).toEqual(
      STATIONS.map((_, index) => [
        `${String(expected[index]?.leftPct)}%`,
        `${String(expected[index]?.topPct)}%`,
      ]),
    );
  });

  it("dims spots that did not make the route", () => {
    renderTrail();
    expect(document.querySelectorAll(".chat-map-pin--dimmed")).toHaveLength(1);
    expect(ruleDeclaration(chatCss, ".chat-map-pin--dimmed", "opacity")).toBe("0.35");
  });

  it("shows the gold route pill in the frame corner, styled by gold tokens", () => {
    renderTrail();
    expect(screen.getByText(dict.route.routePill).className).toBe("chat-route-pill");
    expect(ruleDeclaration(chatCss, ".chat-route-pill", "background")).toBe("var(--color-gold-soft)");
    expect(ruleDeclaration(chatCss, ".chat-route-map__line", "stroke")).toBe("var(--color-gold)");
  });
});

describe("accessibility of the promoted map", () => {
  it("labels the frame and hides the decorative overlay from AT", () => {
    renderTrail();
    expect(screen.getByRole("img", { name: dict.route.mapLabel })).toBeTruthy();
    const overlay = document.querySelector(".chat-search-map__overlay");
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("degradation", () => {
  it("falls back to the D7 doodle when the basemap fails", () => {
    renderTrail(attachFailing);
    expect(screen.getByText(dict.errorStates.d7Message)).toBeTruthy();
    expect(document.querySelector(".chat-route-pin")).toBeNull();
  });
});
