/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteDetailPendingState } from "../../../src/components/route-detail/route-states";

afterEach(cleanup);

describe("RouteDetailPendingState", () => {
  it("announces a loading status while the route loads", () => {
    render(<RouteDetailPendingState />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
  });
});
