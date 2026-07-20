/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GoldBar } from "../../../src/components/route-detail/GoldBar";
import { ROUTE_DETAIL_SCHEMA_VERSION } from "../../../src/lib/route-detail/dataState";

afterEach(cleanup);

describe("GoldBar generative component", () => {
  it("renders the today label as a link to the Walk Mode target", () => {
    render(
      <GoldBar
        payload={{ schema_version: ROUTE_DETAIL_SCHEMA_VERSION, label: "巡礼日", href: "/walk/r1" }}
      />,
    );
    const link = screen.getByRole("link", { name: "巡礼日" });
    expect(link.getAttribute("href")).toBe("/walk/r1");
  });

  it("renders the skeleton slot instead of crashing when the label is missing", () => {
    render(<GoldBar payload={{ schema_version: ROUTE_DETAIL_SCHEMA_VERSION }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("tolerates a legacy payload missing the href (additive-only evolution)", () => {
    render(<GoldBar payload={{ schema_version: 0, label: "巡礼日" }} />);
    expect(screen.getByRole("link", { name: "巡礼日" }).getAttribute("href")).toBe("#");
  });
});
