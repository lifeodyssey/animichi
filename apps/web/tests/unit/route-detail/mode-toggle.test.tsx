/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModeToggle } from "../../../src/components/route-detail/ModeToggle";
import { routeDetailCopyFor } from "../../../src/lib/route-detail/copy";

afterEach(cleanup);

const copy = routeDetailCopyFor("ja");

describe("ModeToggle", () => {
  it("labels itself expand and is unpressed when idle", () => {
    render(<ModeToggle mode="idle" onToggle={vi.fn()} copy={copy} />);
    const button = screen.getByRole("button", { name: copy.mapExpand });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("labels itself collapse and is pressed when expanded", () => {
    render(<ModeToggle mode="expanded" onToggle={vi.fn()} copy={copy} />);
    const button = screen.getByRole("button", { name: copy.mapCollapse });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("requests a toggle on click", () => {
    const onToggle = vi.fn();
    render(<ModeToggle mode="idle" onToggle={onToggle} copy={copy} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
