/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeparturePrompt } from "../../../src/features/chat/components/DeparturePrompt";
import { needsDeparturePrompt } from "../../../src/features/chat/departure";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { useDeparturePrompt } from "../../../src/features/chat/use-departure-prompt";
import { resetGeoPlatform, setGeoPlatform } from "../../../src/platform/geo";

const dict = chatDictFor("ja");

afterEach(() => {
  cleanup();
  resetGeoPlatform();
});

describe("needsDeparturePrompt (AC2 trigger)", () => {
  it("triggers when a route request states neither departure point nor time", () => {
    expect(needsDeparturePrompt("君の名は。のルートを組んで")).toBe(true);
  });

  it.each([
    ["宇治駅から響けのルートを組んで"],
    ["朝9時に出るルートがほしい"],
    ["京阪宇治駅から午前中に回るルート"],
  ])("skips the turn when departure info is already stated: %s", (text) => {
    expect(needsDeparturePrompt(text)).toBe(false);
  });

  it("never triggers for a non-route question", () => {
    expect(needsDeparturePrompt("響け!ユーフォニアムの聖地は?")).toBe(false);
  });
});

function setupHook() {
  const send = vi.fn();
  const sendWithOrigin = vi.fn();
  const { result } = renderHook(() =>
    useDeparturePrompt({ send, regenerate: vi.fn(), sendWithOrigin }, dict),
  );
  return { send, sendWithOrigin, result };
}

describe("useDeparturePrompt (AC2 flow)", () => {
  it("holds a route request missing both facts instead of sending", () => {
    const { send, result } = setupHook();
    act(() => { result.current.onSend("君の名は。のルートを組んで"); });
    expect(send).not.toHaveBeenCalled();
  });

  it("passes a fully-stated request straight through", () => {
    const { send, result } = setupHook();
    act(() => { result.current.onSend("宇治駅から朝9時のルートを組んで"); });
    expect(send).toHaveBeenCalledWith("宇治駅から朝9時のルートを組んで");
  });

  it("おまかせ sends the held request unchanged", async () => {
    const { send, result } = setupHook();
    act(() => { result.current.onSend("君の名は。のルートを組んで"); });
    await vi.waitFor(() => { expect(result.current.pending).not.toBeNull(); });
    act(() => { result.current.onChip("auto"); });
    expect(send).toHaveBeenCalledWith("君の名は。のルートを組んで");
  });

  it("駅から+time appends the station suffix", async () => {
    const { send, result } = setupHook();
    act(() => { result.current.onSend("君の名は。のルートを組んで"); });
    await vi.waitFor(() => { expect(result.current.pending).not.toBeNull(); });
    act(() => { result.current.onChip("station"); });
    expect(send).toHaveBeenCalledWith(`君の名は。のルートを組んで${dict.departure.stationSuffix}`);
  });

  it("manual dismisses the prompt and lets the next send pass unguarded", async () => {
    const { send, result } = setupHook();
    act(() => { result.current.onSend("君の名は。のルートを組んで"); });
    await vi.waitFor(() => { expect(result.current.pending).not.toBeNull(); });
    act(() => { result.current.onChip("manual"); });
    act(() => { result.current.onSend("君の名は。のルートを組んで"); });
    expect(send).toHaveBeenCalledWith("君の名は。のルートを組んで");
  });

  it("a granted location resolves the held turn with origin coordinates", async () => {
    const { send, sendWithOrigin, result } = setupHook();
    act(() => { result.current.onSend("君の名は。のルートを組んで"); });
    await vi.waitFor(() => { expect(result.current.pending).not.toBeNull(); });
    act(() => { result.current.onLocated(34.9, 135.8); });
    expect(sendWithOrigin).toHaveBeenCalledWith("君の名は。のルートを組んで", 34.9, 135.8);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("DeparturePrompt chips (AC2 render)", () => {
  function renderChips(onChip = vi.fn()) {
    render(
      <DeparturePrompt dict={dict} onChip={onChip} onLocated={vi.fn()} onManualLocation={vi.fn()} />,
    );
    return onChip;
  }

  it("offers the four chips", () => {
    renderChips();
    expect(screen.getByRole("button", { name: dict.departure.stationChip })).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.departure.hereChip })).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.departure.manualChip })).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.departure.autoChip })).toBeTruthy();
  });

  it("routes station/manual/auto picks to onChip", () => {
    const onChip = renderChips();
    fireEvent.click(screen.getByRole("button", { name: dict.departure.stationChip }));
    fireEvent.click(screen.getByRole("button", { name: dict.departure.autoChip }));
    expect(onChip.mock.calls).toEqual([["station"], ["auto"]]);
  });

  it("現在地 swaps in the C4 location prompt", () => {
    setGeoPlatform({ requestPermission: vi.fn().mockResolvedValue({ status: "denied" }) });
    renderChips();
    fireEvent.click(screen.getByRole("button", { name: dict.departure.hereChip }));
    expect(screen.getByRole("button", { name: dict.location.allow })).toBeTruthy();
  });
});
