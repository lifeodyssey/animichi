/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRoute } from "@seichijunrei/contract";
import { TimedItinerary } from "../../../src/features/chat/components/TimedItinerary";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { DEFERRED_SAVE_KEY, readDeferredSave } from "../../../src/features/chat/save/deferredSave";
import { saveAction } from "../../../src/features/chat/save/useSaveGate";
import type { SaveGateOptions } from "../../../src/features/chat/save/useSaveGate";
import { itineraryView } from "../../../src/lib/chat/itinerary";
import { renderWithLocale, setLanguages } from "../_i18n";
import { ujiItinerary } from "./_route-fixtures";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ja = chatDictFor("ja");
const TARGET = { pointIds: ["a", "b", "c"], title: "宇治・3スポットの聖地巡礼" } as const;
const SAVED = { id: "r1", title: TARGET.title, point_ids: [...TARGET.pointIds], status: "saved", saved_at: null, updated_at: "" } as UserRoute;

function renderCta(deps: SaveGateOptions, target: typeof TARGET | undefined) {
  return renderWithLocale(
    <TimedItinerary view={itineraryView(ujiItinerary())} dict={ja} save={target} saveDeps={deps} />,
  );
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: ja.route.saveCta }) as HTMLButtonElement;
}

describe("the login-wall predicate is a single rule", () => {
  it.each([
    ["authenticated", "save"],
    ["anonymous", "login"],
    ["pending", "none"],
  ] as const)("maps a %s caller with a route to %s", (status, expected) => {
    expect(saveAction(TARGET, status)).toBe(expected);
  });

  it.each(["authenticated", "anonymous", "pending"] as const)("never acts without a route (%s)", (status) => {
    expect(saveAction(undefined, status)).toBe("none");
    expect(saveAction({ pointIds: [], title: "x" }, status)).toBe("none");
  });
});

describe("AC2: a signed-in tap saves once and never opens the dialog", () => {
  it("calls saveRoute exactly once with the rendered stops, in order", async () => {
    const request = vi.fn().mockResolvedValue(SAVED);
    renderCta({ authStatus: "authenticated", request }, TARGET);
    fireEvent.click(saveButton());
    await waitFor(() => { expect(request).toHaveBeenCalledTimes(1); });
    const input = request.mock.calls[0]?.[0] as { point_ids: string[]; status: string };
    expect(input.point_ids).toEqual(["a", "b", "c"]);
    expect(input.point_ids.length).toBeGreaterThan(0);
    expect(input.point_ids.length).toBe(document.querySelectorAll(".chat-itinerary__stop").length);
    expect(input.status).toBe("saved");
  });

  it("confirms on the card and leaves the login dialog unopened", async () => {
    renderCta({ authStatus: "authenticated", request: vi.fn().mockResolvedValue(SAVED) }, TARGET);
    fireEvent.click(saveButton());
    expect(await screen.findByText(ja.route.saved)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });
});

describe("AC1/AC4 (unit twin): an anonymous tap opens the wall and stashes the intent", () => {
  it("opens the magic-link dialog only after the tap", async () => {
    const request = vi.fn();
    renderCta({ authStatus: "anonymous", request }, TARGET);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(saveButton());
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it("writes the point ids and derived title into the deferred intent", () => {
    renderCta({ authStatus: "anonymous", request: vi.fn() }, TARGET);
    fireEvent.click(saveButton());
    expect(readDeferredSave()?.pointIds).toEqual(["a", "b", "c"]);
    expect(readDeferredSave()?.title).toBe(TARGET.title);
  });
});

describe("AC6: with no route generated yet the CTA is inert", () => {
  it("renders disabled, opens nothing and writes no intent when tapped", () => {
    const request = vi.fn();
    renderCta({ authStatus: "anonymous", request }, undefined);
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("the login wall closes without saving anything", () => {
  it("dismisses the dialog on the close button and issues no save", async () => {
    const request = vi.fn();
    renderCta({ authStatus: "anonymous", request }, TARGET);
    fireEvent.click(saveButton());
    fireEvent.click(await screen.findByRole("button", { name: "閉じる" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("AC7: a failed save is retryable in place", () => {
  it("shows an inline error, keeps the card, and forces no logout or dialog", async () => {
    renderCta({ authStatus: "authenticated", request: vi.fn().mockRejectedValue(new Error("502")) }, TARGET);
    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toContain(ja.route.saveError);
    expect(screen.getByRole("list", { name: ja.route.timelineLabel })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retries the same save from the inline retry button", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("502")).mockResolvedValue(SAVED);
    renderCta({ authStatus: "authenticated", request }, TARGET);
    fireEvent.click(saveButton());
    fireEvent.click(await screen.findByRole("button", { name: ja.route.saveRetry }));
    expect(await screen.findByText(ja.route.saved)).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
