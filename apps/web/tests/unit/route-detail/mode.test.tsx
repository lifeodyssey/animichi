/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MODE_TRANSITION_MS,
  initialMode,
  nextMode,
  useRouteMode,
} from "../../../src/lib/route-detail/mode";

afterEach(cleanup);

describe("mode transitions", () => {
  it("flips idle to expanded and back", () => {
    expect(nextMode("idle")).toBe("expanded");
    expect(nextMode("expanded")).toBe("idle");
  });

  it("opens expanded on the today state and idle otherwise", () => {
    expect(initialMode("today")).toBe("expanded");
    expect(initialMode("weekday")).toBe("idle");
    expect(initialMode("completed")).toBe("idle");
  });
});

function ModeHarness() {
  const { mode, toggle } = useRouteMode("idle");
  return (
    <button type="button" onClick={toggle}>
      {mode}
    </button>
  );
}

describe("useRouteMode debounce guard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("switches mode on a single toggle", () => {
    render(<ModeHarness />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("expanded");
  });

  it("ignores a rapid second toggle until the transition finishes", () => {
    render(<ModeHarness />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("expanded");
  });

  it("accepts the next toggle after the transition window elapses", () => {
    render(<ModeHarness />);
    fireEvent.click(screen.getByRole("button"));
    vi.advanceTimersByTime(MODE_TRANSITION_MS);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("idle");
  });
});
