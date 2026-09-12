/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TurnstileGate, TURNSTILE_TEST_SITE_KEY } from "../../../src/features/chat/components/TurnstileGate";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { installTurnstileSdk, renderedOptions } from "./turnstile-sdk-fixture";

afterEach(() => { cleanup(); window.turnstile = undefined; vi.restoreAllMocks(); });

it.each([
  ["error-callback", "onAnimichiTurnstileError"],
  ["expired-callback", "onAnimichiTurnstileExpired"],
  ["timeout-callback", "onAnimichiTurnstileError"],
  ["before-interactive-callback", "onAnimichiTurnstileInteractive"],
  ["after-interactive-callback", "onAnimichiTurnstileInteractiveEnd"],
] as const)("does not deliver a removed widget's %s to the current gate", async (event, handlerName) => {
  const sdk = installTurnstileSdk();
  const view = render(<TurnstileGate dict={chatDictFor("zh")} siteKey={TURNSTILE_TEST_SITE_KEY} />);
  await waitFor(() => { expect(sdk.render).toHaveBeenCalledTimes(1); });
  const previous = renderedOptions(sdk);
  view.rerender(<TurnstileGate dict={chatDictFor("ja")} siteKey={TURNSTILE_TEST_SITE_KEY} />);
  await waitFor(() => { expect(sdk.render).toHaveBeenCalledTimes(2); });
  const currentHandler = vi.spyOn(window, handlerName);
  act(() => { previous[event](); });
  expect(currentHandler).not.toHaveBeenCalled();
  act(() => { renderedOptions(sdk, 1)[event](); });
  expect(currentHandler).toHaveBeenCalledOnce();
});
