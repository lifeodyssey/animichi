/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRoute } from "@seichijunrei/contract";
import { TimedItinerary } from "../../../src/features/chat/components/TimedItinerary";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { DEFERRED_SAVE_KEY, DEFERRED_SAVE_TTL_MS, readDeferredSave, writeDeferredSave } from "../../../src/features/chat/save/deferredSave";
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

describe("P2-6: mounting a card sweeps an abandoned intent", () => {
  it("erases an intent that outlived its TTL, so a shared device does not accumulate", () => {
    writeDeferredSave(TARGET, Date.now() - DEFERRED_SAVE_TTL_MS - 1);
    renderCta({ authStatus: "anonymous", request: vi.fn() }, TARGET);
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });

  it("leaves a live intent alone", () => {
    writeDeferredSave(TARGET, Date.now());
    renderCta({ authStatus: "anonymous", request: vi.fn() }, TARGET);
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeTruthy();
  });
});

describe("P1-1: a double tap cannot create two rows", () => {
  it("issues exactly one saveRoute for two rapid clicks", async () => {
    const request = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => { resolve(SAVED); }, 20)));
    renderCta({ authStatus: "authenticated", request }, TARGET);
    fireEvent.click(saveButton());
    fireEvent.click(saveButton());
    await waitFor(() => { expect(screen.getByText(ja.route.saved)).toBeTruthy(); });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("disables the CTA while saving and after it saved", async () => {
    const request = vi.fn().mockResolvedValue(SAVED);
    renderCta({ authStatus: "authenticated", request }, TARGET);
    fireEvent.click(saveButton());
    await waitFor(() => { expect(screen.getByText(ja.route.saved)).toBeTruthy(); });
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().getAttribute("aria-busy")).toBe("false");
  });
});

describe("P2-1: failures are classified, not flattened", () => {
  it("sends a 401 back through the login wall with a fresh intent", async () => {
    const request = vi.fn().mockRejectedValue({ status: 401 });
    renderCta({ authStatus: "authenticated", request }, TARGET);
    fireEvent.click(saveButton());
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(readDeferredSave()?.pointIds).toEqual(["a", "b", "c"]);
  });

  it("offers no retry for a permanent 4xx", async () => {
    const request = vi.fn().mockRejectedValue({ status: 422 });
    renderCta({ authStatus: "authenticated", request }, TARGET);
    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toContain(ja.route.savePermanentError);
    expect(screen.queryByRole("button", { name: ja.route.saveRetry })).toBeNull();
  });

  it("offers a retry for a 5xx", async () => {
    const request = vi.fn().mockRejectedValue({ status: 503 });
    renderCta({ authStatus: "authenticated", request }, TARGET);
    fireEvent.click(saveButton());
    expect(await screen.findByRole("button", { name: ja.route.saveRetry })).toBeTruthy();
  });
});
