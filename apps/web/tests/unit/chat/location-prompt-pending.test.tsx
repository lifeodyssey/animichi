/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationPrompt } from "../../../src/features/chat/components/LocationPrompt";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { resetGeoPlatform, setGeoPlatform } from "../../../src/platform/geo";
import type { GeoPermission } from "../../../src/platform/geo";

const dict = chatDictFor("ja");
afterEach(() => { cleanup(); resetGeoPlatform(); });

function pendingPrompt() {
  const pending = deferredPermission();
  const requestPermission = vi.fn().mockReturnValue(pending.promise);
  setGeoPlatform({ requestPermission });
  const onLocated = vi.fn();
  const onManual = vi.fn();
  const view = render(<LocationPrompt dict={dict} onLocated={onLocated} onManual={onManual} />);
  return { pending, requestPermission, onLocated, onManual, view };
}

function deferredPermission() {
  let resolve!: (permission: GeoPermission) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<GeoPermission>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

describe("location entry choices", () => {
  it("allows a manual place without requesting permission", () => {
    const { onManual, requestPermission } = pendingPrompt();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: " 宇治駅 " } });
    fireEvent.click(screen.getByRole("button", { name: dict.location.manualSubmit }));
    expect(onManual).toHaveBeenCalledExactlyOnceWith("宇治駅");
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(dict.location.sent);
  });

  it("prevents duplicate permission requests while waiting", async () => {
    const { requestPermission, pending } = pendingPrompt();
    const allow = screen.getByRole("button", { name: dict.location.allow });
    fireEvent.click(allow); fireEvent.click(allow);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(allow.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe(dict.location.waiting);
    await act(async () => { pending.resolve({ status: "denied" }); await pending.promise; });
    expect(allow.hasAttribute("disabled")).toBe(false);
  });

  it("ignores late coordinates once a manual answer has been sent", async () => {
    const { pending, onManual, onLocated } = pendingPrompt();
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "宇治駅" } });
    fireEvent.submit(screen.getByRole("textbox"));
    await act(async () => { pending.resolve({ status: "granted", lat: 35, lng: 139 }); await pending.promise; });
    expect(onManual).toHaveBeenCalledExactlyOnceWith("宇治駅");
    expect(onLocated).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(dict.location.sent);
  });

});

describe("location permission failures", () => {
  it("shows a recoverable fallback for a rejected location request", async () => {
    const { pending } = pendingPrompt();
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    await act(async () => { pending.reject(new Error("location unavailable")); await pending.promise.catch(() => undefined); });
    expect(screen.getByRole("status").textContent).toBe(dict.location.denied);
    expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
  });

  it("does not send coordinates after the prompt unmounts", async () => {
    const { pending, view, onLocated } = pendingPrompt();
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    view.unmount();
    await act(async () => { pending.resolve({ status: "granted", lat: 35, lng: 139 }); await pending.promise; });
    expect(onLocated).not.toHaveBeenCalled();
  });

  it("ignores a late rejection after a manual answer", async () => {
    const { pending } = pendingPrompt();
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "宇治駅" } });
    fireEvent.submit(screen.getByRole("textbox"));
    await act(async () => { pending.reject(new Error("location unavailable")); await pending.promise.catch(() => undefined); });
    expect(screen.getByRole("status").textContent).toBe(dict.location.sent);
  });
});
