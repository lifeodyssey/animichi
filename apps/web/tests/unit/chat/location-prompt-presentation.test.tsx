/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationPrompt } from "../../../src/features/chat/components/LocationPrompt";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { resetGeoPlatform, setGeoPlatform } from "../../../src/platform/geo";
import type { GeoPermission } from "../../../src/platform/geo";

const dict = chatDictFor("zh");
afterEach(() => { cleanup(); resetGeoPlatform(); });

function pendingPermission() {
  let resolve: (permission: GeoPermission) => void = () => undefined;
  const promise = new Promise<GeoPermission>((accept) => { resolve = accept; });
  const requestPermission = vi.fn().mockReturnValue(promise);
  setGeoPlatform({ requestPermission });
  return { resolve, promise, requestPermission };
}

function mount(disabled = false) {
  const onLocated = vi.fn(), onManual = vi.fn();
  render(<LocationPrompt dict={dict} disabled={disabled} onLocated={onLocated} onManual={onManual} />);
  return { onLocated, onManual };
}

describe("location choice confirmation", () => {
  it("keeps the submitted place visible and retires the form", () => {
    const pending = pendingPermission(), actions = mount();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  宇治站  " } });
    fireEvent.submit(screen.getByRole("textbox"));
    expect(screen.getByText("宇治站")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(dict.location.sent);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(actions.onManual).toHaveBeenCalledExactlyOnceWith("宇治站");
    expect(pending.requestPermission).not.toHaveBeenCalled();
  });

  it("confirms current location without exposing raw coordinates as the place name", async () => {
    const pending = pendingPermission(), actions = mount();
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    await act(async () => { pending.resolve({ status: "granted", lat: 34.8843, lng: 135.8008 }); await pending.promise; });
    expect(screen.getByText(dict.location.current)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(dict.location.sent);
    expect(screen.queryByText(/34\.8843|135\.8008/)).toBeNull();
    expect(actions.onLocated).toHaveBeenCalledExactlyOnceWith(34.8843, 135.8008);
    expect(actions.onManual).not.toHaveBeenCalled();
  });
});

describe("manual entry stays available", () => {
  it("preserves a typed place while a pending permission request fails", async () => {
    const pending = pendingPermission(); mount();
    const input = screen.getByRole("textbox", { name: dict.location.manualLabel });
    fireEvent.change(input, { target: { value: "四谷站" } });
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    expect(input.hasAttribute("disabled")).toBe(false);
    await act(async () => { pending.resolve({ status: "denied" }); await pending.promise; });
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input.getAttribute("value")).toBe("四谷站");
    expect(screen.getByRole("button", { name: dict.location.manualSubmit }).hasAttribute("disabled")).toBe(false);
  });

  it("honors the caller lock for both entry methods", () => {
    const pending = pendingPermission(), actions = mount(true);
    const input = screen.getByRole("textbox", { name: dict.location.manualLabel });
    expect(input.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: dict.location.allow }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: "宇治站" } });
    fireEvent.submit(input);
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    expect(actions.onManual).not.toHaveBeenCalled();
    expect(pending.requestPermission).not.toHaveBeenCalled();
  });
});
