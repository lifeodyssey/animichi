/**
 * @vitest-environment jsdom
 *
 * #507 review P1-3: "not silent" has to mean something. `apps/web` has no
 * telemetry sink, so a `console.warn` reaches the visitor's own devtools and
 * nobody else — the callback screen is the only real outlet, and the visitor
 * the only party who can act. These pin that the failure reaches the DOM with
 * a working retry, and that it never blocks the login itself.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallback } from "../../../src/components/auth/AuthCallback";
import type { SessionAdoptionOutcome } from "../../../src/lib/auth/session-adoption";
import { dictFor } from "../../../src/i18n/dictionaries";
import { renderWithLocale, setLanguages } from "../_i18n";

const auth = dictFor("ja").auth;
const token = (): Promise<string | undefined> => Promise.resolve("jwt-1");
const noReplay = () => Promise.resolve("none" as const);

beforeEach(() => {
  setLanguages(["ja-JP"]);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderCallback(adopt: () => Promise<SessionAdoptionOutcome>, onDone = () => undefined) {
  return renderWithLocale(
    <AuthCallback onDone={onDone} establish={token} replay={noReplay} adopt={adopt} />,
  );
}

describe("the adoption failure reaches the visitor", () => {
  it("renders an alert with a retry and a skip, not a silent success", async () => {
    renderCallback(() => Promise.resolve("failed"));
    expect(await screen.findByText(auth.callback_adoption_failed)).toBeTruthy();
    expect(screen.getByRole("button", { name: auth.callback_adoption_retry })).toBeTruthy();
    expect(screen.getByRole("button", { name: auth.callback_adoption_skip })).toBeTruthy();
  });

  it("does not navigate away while the notice is unanswered", async () => {
    const onDone = vi.fn();
    renderCallback(() => Promise.resolve("failed"), onDone);
    await screen.findByText(auth.callback_adoption_failed);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("navigates once the visitor chooses to move on — the login is never blocked", async () => {
    const onDone = vi.fn();
    renderCallback(() => Promise.resolve("failed"), onDone);
    fireEvent.click(await screen.findByRole("button", { name: auth.callback_adoption_skip }));
    await waitFor(() => { expect(onDone).toHaveBeenCalled(); });
  });

  it("clears the notice and navigates when a retry lands", async () => {
    const onDone = vi.fn();
    const adopt = vi.fn<() => Promise<SessionAdoptionOutcome>>().mockResolvedValue("failed");
    renderCallback(adopt, onDone);
    fireEvent.click(await screen.findByRole("button", { name: auth.callback_adoption_retry }));
    adopt.mockResolvedValue("adopted");
    fireEvent.click(screen.getByRole("button", { name: auth.callback_adoption_retry }));
    await waitFor(() => { expect(onDone).toHaveBeenCalled(); });
  });

  it("says nothing at all when the claim succeeds", async () => {
    const onDone = vi.fn();
    renderCallback(() => Promise.resolve("adopted"), onDone);
    await waitFor(() => { expect(onDone).toHaveBeenCalled(); });
    expect(screen.queryByText(auth.callback_adoption_failed)).toBeNull();
  });
});

describe("the cross-device case gets its own copy", () => {
  it("explains that nothing was found rather than that something broke", async () => {
    renderWithLocale(
      <AuthCallback
        onDone={() => undefined}
        expectsAdoption
        establish={token}
        replay={noReplay}
        adopt={() => Promise.resolve("nothing")}
      />,
    );
    expect(await screen.findByText(auth.callback_adoption_missing)).toBeTruthy();
    expect(screen.queryByText(auth.callback_adoption_failed)).toBeNull();
  });
});
