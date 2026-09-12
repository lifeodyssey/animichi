/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceMapMarker, type PlaceMapMarkerProps } from "../../../src/features/chat/components/PlaceMapMarker";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);
const dict = chatDictFor("zh");
const defaults = { id: "suga", name: "須賀神社 男坂", position: { leftPct: 50, topPct: 40 }, dict };

function Marker({ onOpen = vi.fn(), onToggle = vi.fn(), ...props }: Partial<PlaceMapMarkerProps>) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState(false);
  return <PlaceMapMarker {...defaults} active={active} selected={selected} onOpen={() => { setActive(true); onOpen(); }} onToggle={() => { setSelected((value) => !value); onToggle(); }} {...props} />;
}

describe("map browsing and selection", () => {
  it("opens the existing place name without selecting", () => {
    const onToggle = vi.fn();
    render(<Marker onToggle={onToggle} />);
    const pin = screen.getByRole("button", { name: defaults.name });
    expect(pin.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(pin);
    expect(pin.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(defaults.name)).toBeTruthy();
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps a selection when the marker closes and reopens", () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(<Marker onOpen={onOpen} onToggle={onToggle} />);
    const pin = screen.getByRole("button");
    fireEvent.click(pin);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择这个圣地: 須賀神社 男坂" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.getByText("已选 1 处")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.click(pin);
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  });
});

describe("transient map names", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("does not permanently label the viewed or selected place", () => {
    render(<Marker active selected />);
    expect(screen.getByRole("button").getAttribute("aria-current")).toBe("location");
    expect(screen.queryByText(defaults.name)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("reveals on hover and dismisses on leaving without changing the viewed place", () => {
    const onOpen = vi.fn();
    render(<Marker onOpen={onOpen} />);
    const pin = screen.getByRole("button");
    fireEvent.pointerOver(pin, { pointerType: "mouse" });
    expect(screen.getByRole("checkbox")).toBeTruthy();
    fireEvent.pointerOut(pin, { pointerType: "mouse", relatedTarget: document.body });
    act(() => { vi.runOnlyPendingTimers(); });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("allows crossing into hover details and choosing without first clicking the pin", () => {
    const onOpen = vi.fn(), onToggle = vi.fn();
    render(<Marker onOpen={onOpen} onToggle={onToggle} />);
    const pin = screen.getByRole("button");
    fireEvent.pointerOver(pin, { pointerType: "mouse" });
    const pick = screen.getByRole("checkbox");
    fireEvent.pointerOut(pin, { pointerType: "mouse", relatedTarget: document.body });
    fireEvent.pointerOver(pick, { pointerType: "mouse" });
    act(() => { vi.runOnlyPendingTimers(); });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("map marker keyboard and controlled state", () => {
  it("supports keyboard opening, choosing, and Escape with focus restored", async () => {
    const user = userEvent.setup();
    render(<Marker />);
    const pin = screen.getByRole("button");
    pin.focus();
    await user.keyboard("{Enter}{Tab} ");
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(document.activeElement).toBe(pin);
    expect(screen.getByText("已选 1 处")).toBeTruthy();
  });

  it("opens on keyboard focus and closes when focus leaves the marker", async () => {
    const user = userEvent.setup();
    render(<><Marker /><button type="button">Outside</button></>);
    await user.tab();
    expect(screen.getByRole("checkbox")).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("checkbox"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("does not open a closed marker in response to Escape or other keys", () => {
    const onOpen = vi.fn();
    render(<Marker onOpen={onOpen} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowDown" });
    expect(onOpen).not.toHaveBeenCalled();
  });

});

describe("map marker external state", () => {
  it("reflects external selection and preserves the full long name for accessibility", () => {
    const name = "東京都新宿区須賀町・須賀神社の男坂（長い名称の表示例）";
    const view = render(<Marker name={name} active selected={false} />);
    expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByText(name).getAttribute("title")).toBe(name);
    view.rerender(<Marker name={name} active selected />);
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  });
});

it("hides controls once their geographic point moves outside the viewport", () => {
  const view = render(<Marker active />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("checkbox")).toBeTruthy();
  view.rerender(<Marker active position={{ leftPct: -10, topPct: 40 }} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  view.rerender(<Marker active position={{ leftPct: 70, topPct: 85 }} />);
  expect(screen.getByRole("button")).toBeTruthy();
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
});
