/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationPrompt } from "../../../src/features/chat/components/LocationPrompt";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { resetGeoPlatform, setGeoPlatform } from "../../../src/platform/geo";
import type { GeoPermission } from "../../../src/platform/geo";

const dict = chatDictFor("ja");

afterEach(() => {
  cleanup();
  resetGeoPlatform();
  vi.unstubAllGlobals();
});

function renderPrompt(permission: GeoPermission) {
  const requestPermission = vi.fn().mockResolvedValue(permission);
  setGeoPlatform({ requestPermission });
  const onLocated = vi.fn();
  const onManual = vi.fn();
  render(<LocationPrompt dict={dict} onLocated={onLocated} onManual={onManual} />);
  return { requestPermission, onLocated, onManual };
}

describe("LocationPrompt (C4)", () => {
  it("grants through the platform layer, never navigator.geolocation (AC8)", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    const { requestPermission, onLocated } = renderPrompt({ status: "granted", lat: 34.9, lng: 135.8 });
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    await waitFor(() => { expect(onLocated).toHaveBeenCalledWith(34.9, 135.8); });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("falls back to manual text entry after a denial — not a dead end (AC3)", async () => {
    const { onManual } = renderPrompt({ status: "denied" });
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    expect(await screen.findByText(dict.location.denied)).toBeTruthy();
    const input = screen.getByRole("textbox", { name: dict.location.manualPlaceholder });
    fireEvent.change(input, { target: { value: " 宇治駅 " } });
    fireEvent.click(screen.getByRole("button", { name: dict.location.manualSubmit }));
    expect(onManual).toHaveBeenCalledWith("宇治駅");
  });

  it("ignores an empty manual submission", async () => {
    const { onManual } = renderPrompt({ status: "denied" });
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    await screen.findByText(dict.location.denied);
    const submit = screen.getByRole("button", { name: dict.location.manualSubmit });
    expect(submit.hasAttribute("disabled")).toBe(true);
    const input = screen.getByRole("textbox", { name: dict.location.manualPlaceholder });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input);
    expect(onManual).not.toHaveBeenCalled();
  });
});
