/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteDetailPendingState } from "../../../src/features/route-detail/components/RouteDetailStates";

afterEach(cleanup);

describe("RouteDetailPendingState", () => {
  it("announces a loading status while the route loads", () => {
    render(<RouteDetailPendingState />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
  });
});
