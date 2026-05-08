/**
 * SelectionBar (layout) — overlay bar shown when spots are selected.
 *
 * AC coverage:
 * - SelectionBar shows count and route button -> unit
 * - Route button is disabled when count < 2 -> unit
 * - Clear button calls onClear -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectionBar } from "@/components/layout/SelectionBar";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({ useDict: () => defaultDict }));

describe("SelectionBar (layout overlay)", () => {
  it("renders selection count text", () => {
    render(
      <SelectionBar count={3} onPlanRoute={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByText(/選択中 3 件/)).toBeInTheDocument();
  });

  it("renders route plan button", () => {
    render(
      <SelectionBar count={2} onPlanRoute={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByText(/ルートを計画/)).toBeInTheDocument();
  });

  it("calls onPlanRoute when route button is clicked", () => {
    const onPlanRoute = vi.fn();
    render(
      <SelectionBar count={2} onPlanRoute={onPlanRoute} onClear={vi.fn()} />,
    );
    fireEvent.click(screen.getByText(/ルートを計画/).closest("button")!);
    expect(onPlanRoute).toHaveBeenCalledOnce();
  });

  it("disables route button when count < 2", () => {
    render(
      <SelectionBar count={1} onPlanRoute={vi.fn()} onClear={vi.fn()} />,
    );
    const routeBtn = screen.getByText(/ルートを計画/).closest("button");
    expect(routeBtn).toBeDisabled();
  });

  it("calls onClear when clear button is clicked", () => {
    const onClear = vi.fn();
    render(
      <SelectionBar count={2} onPlanRoute={vi.fn()} onClear={onClear} />,
    );
    fireEvent.click(screen.getByText("クリア"));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("renders data-testid for querying", () => {
    render(
      <SelectionBar count={1} onPlanRoute={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByTestId("selection-bar")).toBeInTheDocument();
  });

  it("adjusts left position when hasFloatingList is true", () => {
    render(
      <SelectionBar count={2} onPlanRoute={vi.fn()} onClear={vi.fn()} hasFloatingList />,
    );
    const bar = screen.getByTestId("selection-bar");
    expect(bar.className).toContain("left-[232px]");
  });

  it("uses left-3 when hasFloatingList is false", () => {
    render(
      <SelectionBar count={2} onPlanRoute={vi.fn()} onClear={vi.fn()} />,
    );
    const bar = screen.getByTestId("selection-bar");
    expect(bar.className).toContain("left-3");
  });
});
