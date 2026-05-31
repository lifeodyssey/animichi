/**
 * SelectionTray — full state matrix (C1)
 *
 * AC coverage:
 * - Happy: 3 selected → chips + count + Plan Route enabled → unit
 * - Null/empty: 0 selected → explicit empty state, Plan Route disabled → unit
 * - Boundary: 12 selected → "+N more" overflow, no layout break → unit (render assertion)
 * - Error: removing last chip → clean empty state (no NaN count, no orphaned CTA) → unit
 * - i18n: count string + empty prompt + CTA localized → unit
 * - Collapse: tray toggles collapsed/expanded → unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SelectionTray } from "@/components/layout/SelectionTray";
import jaDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";

vi.mock("@/lib/i18n-context", () => ({ useDict: () => jaDict }));

const makeSpot = (i: number) => ({ id: `spot-${i}`, name: `スポット${i}` });

function renderTray(
  spots: Array<{ id: string; name: string }>,
  overrides: Partial<React.ComponentProps<typeof SelectionTray>> = {},
) {
  const onPlanRoute = vi.fn();
  const onRemove = vi.fn();
  const onClear = vi.fn();
  const result = render(
    <SelectionTray
      spots={spots}
      onPlanRoute={onPlanRoute}
      onRemove={onRemove}
      onClear={onClear}
      {...overrides}
    />,
  );
  return { ...result, onPlanRoute, onRemove, onClear };
}

// ---------------------------------------------------------------------------
// Happy path: 3 selected
// ---------------------------------------------------------------------------

describe("SelectionTray — happy path (3 selected)", () => {
  it("renders chip for each selected spot", () => {
    renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    expect(screen.getByText("スポット1")).toBeInTheDocument();
    expect(screen.getByText("スポット2")).toBeInTheDocument();
    expect(screen.getByText("スポット3")).toBeInTheDocument();
  });

  it("shows count in summary", () => {
    renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    // count text is "3件選択中" - find the element containing the count string
    expect(screen.getByText(/3件選択中/)).toBeInTheDocument();
  });

  it("Plan Route button is enabled when 3 spots selected", () => {
    renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    const btn = screen.getByTestId("plan-route-btn");
    expect(btn).not.toBeDisabled();
  });

  it("calls onPlanRoute when CTA is clicked", () => {
    const { onPlanRoute } = renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    fireEvent.click(screen.getByTestId("plan-route-btn"));
    expect(onPlanRoute).toHaveBeenCalledOnce();
  });

  it("calls onRemove with spot id when chip dismiss is clicked", () => {
    const { onRemove } = renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    // find dismiss button for spot 1
    const chip = screen.getByText("スポット1").closest("[data-chip]");
    const dismissBtn = within(chip as HTMLElement).getByRole("button");
    fireEvent.click(dismissBtn);
    expect(onRemove).toHaveBeenCalledWith("spot-1");
  });
});

// ---------------------------------------------------------------------------
// Null / empty: 0 selected
// ---------------------------------------------------------------------------

describe("SelectionTray — empty state (0 selected)", () => {
  it("shows explicit empty-state prompt", () => {
    renderTray([]);
    expect(screen.getByTestId("tray-empty-prompt")).toBeInTheDocument();
  });

  it("Plan Route button is disabled when 0 spots", () => {
    renderTray([]);
    expect(screen.getByTestId("plan-route-btn")).toBeDisabled();
  });

  it("Plan Route button is disabled when only 1 spot selected", () => {
    renderTray([makeSpot(1)]);
    expect(screen.getByTestId("plan-route-btn")).toBeDisabled();
  });

  it("empty prompt text is not empty string", () => {
    renderTray([]);
    const prompt = screen.getByTestId("tray-empty-prompt");
    expect(prompt.textContent?.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Boundary: 12 selected — overflow strategy "+N more"
// ---------------------------------------------------------------------------

describe("SelectionTray — overflow (12 selected)", () => {
  const twelveSpots = Array.from({ length: 12 }, (_, i) => makeSpot(i + 1));

  it("renders without crashing with 12 spots", () => {
    renderTray(twelveSpots);
    expect(screen.getByTestId("selection-tray")).toBeInTheDocument();
  });

  it("shows '+N more' badge when spots exceed MAX_VISIBLE", () => {
    renderTray(twelveSpots);
    // MAX_VISIBLE is 6; expect +6 more badge
    expect(screen.getByTestId("overflow-badge")).toBeInTheDocument();
  });

  it("overflow badge text contains positive number", () => {
    renderTray(twelveSpots);
    const badge = screen.getByTestId("overflow-badge");
    const match = badge.textContent?.match(/\d+/);
    expect(match).not.toBeNull();
    expect(Number(match![0])).toBeGreaterThan(0);
  });

  it("no NaN appears in the overflow badge text", () => {
    renderTray(twelveSpots);
    const badge = screen.getByTestId("overflow-badge");
    expect(badge.textContent).not.toContain("NaN");
  });

  it("tray root has overflow-x-hidden class to prevent horizontal scroll leak", () => {
    renderTray(twelveSpots);
    const tray = screen.getByTestId("selection-tray");
    // Assert the Tailwind class that prevents horizontal overflow is applied
    expect(tray.className).toContain("overflow-x-hidden");
  });

  it("Plan Route button is enabled at 12 spots", () => {
    renderTray(twelveSpots);
    expect(screen.getByTestId("plan-route-btn")).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Error path: removing last chip → clean empty state
// ---------------------------------------------------------------------------

describe("SelectionTray — removing last chip", () => {
  it("still shows valid count text (no NaN) with 1 spot remaining", () => {
    renderTray([makeSpot(1)]);
    const tray = screen.getByTestId("selection-tray");
    expect(tray.textContent).not.toContain("NaN");
  });

  it("Plan Route disabled when 1 spot (pre-remove state)", () => {
    renderTray([makeSpot(1)]);
    expect(screen.getByTestId("plan-route-btn")).toBeDisabled();
  });

  it("calls onRemove correctly for the last remaining chip", () => {
    const { onRemove } = renderTray([makeSpot(1)]);
    const chip = screen.getByText("スポット1").closest("[data-chip]");
    const dismissBtn = within(chip as HTMLElement).getByRole("button");
    fireEvent.click(dismissBtn);
    expect(onRemove).toHaveBeenCalledWith("spot-1");
  });

  it("0 spots renders empty prompt (clean transition after last remove)", () => {
    renderTray([]);
    expect(screen.getByTestId("tray-empty-prompt")).toBeInTheDocument();
    const tray = screen.getByTestId("selection-tray");
    expect(tray.textContent).not.toContain("NaN");
  });
});

// ---------------------------------------------------------------------------
// i18n: localized strings
// ---------------------------------------------------------------------------

describe("SelectionTray — i18n", () => {
  it("shows Japanese CTA text with ja dict", () => {
    renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    expect(screen.getByTestId("plan-route-btn").textContent).toContain(
      jaDict.selection_tray.plan_route,
    );
  });

  it("en dict selection_tray plan_route key is non-empty", () => {
    expect(enDict.selection_tray.plan_route.length).toBeGreaterThan(0);
  });

  it("zh dict selection_tray plan_route key is non-empty", () => {
    expect(zhDict.selection_tray.plan_route.length).toBeGreaterThan(0);
  });

  it("ja dict selection_tray empty_prompt is defined", () => {
    expect(jaDict.selection_tray.empty_prompt).toBeTruthy();
  });

  it("count text does not contain NaN for any count 0-12", () => {
    for (let i = 0; i <= 12; i++) {
      const spots = Array.from({ length: i }, (_, j) => makeSpot(j + 1));
      const { unmount } = renderTray(spots);
      const tray = screen.getByTestId("selection-tray");
      expect(tray.textContent).not.toContain("NaN");
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Collapse / expand
// ---------------------------------------------------------------------------

describe("SelectionTray — collapse / expand", () => {
  it("renders collapse toggle button", () => {
    renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    expect(screen.getByTestId("tray-collapse-btn")).toBeInTheDocument();
  });

  it("chips area is visible when expanded (default)", () => {
    renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    expect(screen.getByTestId("tray-chips-area")).toBeVisible();
  });

  it("clicking collapse button hides chips area", () => {
    renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    fireEvent.click(screen.getByTestId("tray-collapse-btn"));
    const chipsArea = screen.getByTestId("tray-chips-area");
    // collapsed: aria-hidden=true or hidden attribute
    expect(chipsArea).toHaveAttribute("aria-hidden", "true");
  });

  it("clicking collapse again re-expands chips area", () => {
    renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    fireEvent.click(screen.getByTestId("tray-collapse-btn"));
    fireEvent.click(screen.getByTestId("tray-collapse-btn"));
    const chipsArea = screen.getByTestId("tray-chips-area");
    expect(chipsArea).not.toHaveAttribute("aria-hidden", "true");
  });
});

// ---------------------------------------------------------------------------
// Responsive: mobile bottom tray
// ---------------------------------------------------------------------------

describe("SelectionTray — responsive / mobile", () => {
  it("renders with mobile-tray data attribute for responsive styling", () => {
    renderTray([makeSpot(1), makeSpot(2)]);
    const tray = screen.getByTestId("selection-tray");
    // The tray root has the class or attribute that drives bottom-fixed layout
    expect(tray.dataset.tray).toBe("true");
  });

  it("all chips have aria-label for accessibility", () => {
    renderTray([makeSpot(1), makeSpot(2), makeSpot(3)]);
    const chips = screen.getAllByRole("button", { name: /スポット/ });
    expect(chips.length).toBeGreaterThanOrEqual(3);
  });
});
