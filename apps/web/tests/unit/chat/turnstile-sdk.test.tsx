/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnstileGate, TURNSTILE_TEST_SITE_KEY } from "../../../src/features/chat/components/TurnstileGate";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { controlWidgetWidth, installTurnstileSdk, renderedOptions } from "./turnstile-sdk-fixture";

const dict = chatDictFor("zh");
afterEach(() => { cleanup(); window.turnstile = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("the real embed respects Cloudflare's minimum widths", () => {
  it("uses flexible at 300px and remounts as compact below 300px", async () => {
    const resize = controlWidgetWidth(300), sdk = installTurnstileSdk();
    render(<TurnstileGate dict={dict} siteKey={TURNSTILE_TEST_SITE_KEY} />);
    await waitFor(() => { expect(sdk.render).toHaveBeenCalledTimes(1); });
    expect(renderedOptions(sdk)).toMatchObject({ size: "flexible", appearance: "interaction-only", language: "zh-cn", theme: "light" });
    act(() => { resize(299); });
    expect(sdk.remove).toHaveBeenCalledWith("1");
    expect(renderedOptions(sdk, 1).size).toBe("compact");
    act(() => { resize(240); });
    expect(sdk.render).toHaveBeenCalledTimes(2);
    act(() => { resize(320); });
    expect(renderedOptions(sdk, 2).size).toBe("flexible");
  });

  it("mounts compact immediately in a narrow container", async () => {
    controlWidgetWidth(240);
    const sdk = installTurnstileSdk();
    render(<TurnstileGate dict={dict} siteKey={TURNSTILE_TEST_SITE_KEY} />);
    await waitFor(() => { expect(sdk.render).toHaveBeenCalledTimes(1); });
    expect(renderedOptions(sdk).size).toBe("compact");
  });

  it("ignores late callbacks from the widget removed during resizing", async () => {
    const resize = controlWidgetWidth(320), sdk = installTurnstileSdk(), onToken = vi.fn();
    render(<TurnstileGate dict={dict} siteKey={TURNSTILE_TEST_SITE_KEY} onToken={onToken} />);
    await waitFor(() => { expect(sdk.render).toHaveBeenCalledTimes(1); });
    const oldOptions = renderedOptions(sdk);
    act(() => { resize(250); oldOptions.callback("outdated-test-token"); });
    expect(onToken).not.toHaveBeenCalled();
    act(() => { renderedOptions(sdk, 1).callback("current-test-token"); });
    expect(onToken).toHaveBeenCalledExactlyOnceWith("current-test-token");
  });
});

describe("explicit widget lifecycle", () => {
  it("replaces the widget on language changes and removes it on unmount", async () => {
    const sdk = installTurnstileSdk(), onToken = vi.fn();
    const view = render(<TurnstileGate dict={dict} siteKey={TURNSTILE_TEST_SITE_KEY} onToken={onToken} />);
    await waitFor(() => { expect(sdk.render).toHaveBeenCalledTimes(1); });
    view.rerender(<TurnstileGate dict={chatDictFor("ja")} siteKey={TURNSTILE_TEST_SITE_KEY} onToken={onToken} />);
    await waitFor(() => { expect(sdk.render).toHaveBeenCalledTimes(2); });
    expect(sdk.remove).toHaveBeenCalledWith("1");
    expect(renderedOptions(sdk, 1).language).toBe("ja");
    view.unmount();
    expect(sdk.remove).toHaveBeenLastCalledWith("2");
    renderedOptions(sdk, 1).callback("removed-test-token");
    expect(onToken).not.toHaveBeenCalled();
  });
});
