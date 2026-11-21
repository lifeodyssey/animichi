/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthCallback } from "../../../src/components/auth/AuthCallback";
import { DEFERRED_SAVE_KEY, writeDeferredSave } from "../../../src/features/chat/save/deferred-save";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { AppRouterContext } from "../_router";

const { saveSavedRouteRequest } = vi.hoisted(() => ({ saveSavedRouteRequest: vi.fn() }));
vi.mock("../../../src/api/hooks/use-saved-route", () => ({ saveSavedRouteRequest }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const establish = () => Promise.resolve("token");

/**
 * #482 acceptance criterion 3, second half: navigating past a failed
 * create-on-login replay must not consume the intent. The real
 * `replayDeferredSave` is in play here (only its request is stubbed), so a
 * regression that clears the intent on the navigate branch goes red.
 */
describe("#482: the deep-link branch keeps the deferred intent", () => {
  it("retains the live intent when the real replay fails before navigating", async () => {
    saveSavedRouteRequest.mockRejectedValue(new Error("users 503"));
    writeDeferredSave({ pointIds: ["p1"], title: "t" });
    const onDone = vi.fn();
    render(
      <AppRouterContext>
        <LocaleProvider>
          <AuthCallback onDone={onDone} establish={establish} hasReturnIntent />
        </LocaleProvider>
      </AppRouterContext>,
    );
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeTruthy();
  });
});
