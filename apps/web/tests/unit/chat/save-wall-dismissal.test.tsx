/**
 * @vitest-environment jsdom
 *
 * "Send the link, close the modal, go read the email" is the **mainline** of the
 * magic-link flow, not a cancellation. Clearing the deferred intent on every
 * dismissal broke create-on-login silently, so dismissal is conditional: the
 * intent only dies if it is abandoned *before* a link goes out.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMagicLink } from "../../../src/lib/auth/neonAuth";
import { LoginModal } from "../../../src/components/auth/LoginModal";
import { TimedItinerary } from "../../../src/features/chat/components/TimedItinerary";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { DEFERRED_SAVE_KEY } from "../../../src/features/chat/save/deferredSave";
import { itineraryView } from "../../../src/lib/chat/itinerary";
import { renderWithLocale, setLanguages } from "../_i18n";
import { ujiItinerary } from "./_route-fixtures";

vi.mock("../../../src/lib/auth/neonAuth", () => ({ sendMagicLink: vi.fn(), isNeonAuthConfigured: () => true }));
const send = vi.mocked(sendMagicLink);

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const ja = chatDictFor("ja");
const TARGET = { pointIds: ["a", "b", "c"], title: "宇治・3スポットの聖地巡礼" } as const;

function openWall() {
  renderWithLocale(
    <TimedItinerary
      view={itineraryView(ujiItinerary())}
      dict={ja}
      save={TARGET}
      saveDeps={{ authStatus: "anonymous", request: vi.fn() }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: ja.route.saveCta }));
}

async function sendLink(): Promise<void> {
  send.mockResolvedValue("sent");
  fireEvent.change(await screen.findByLabelText("メールアドレス"), { target: { value: "fan@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
  await waitFor(() => { expect(screen.getByRole("status")).toBeTruthy(); });
}

function dismiss(): void {
  fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
}

describe("closing the wall before a link is sent is a cancellation", () => {
  it("drops the intent", () => {
    openWall();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeTruthy();
    dismiss();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });

  it("drops it on Escape too, so every dismissal path agrees", async () => {
    openWall();
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });
});

describe("closing the wall after a link is sent is 'going to read the email'", () => {
  it("keeps the intent so create-on-login can still replay it", async () => {
    openWall();
    await sendLink();
    dismiss();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toContain("a");
  });

  it("keeps it on Escape as well", async () => {
    openWall();
    await sendLink();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeTruthy();
  });

  /** The whole request latency used to be a window in which closing the modal
   * destroyed the intent — the commit is the click, not the server's reply. */
  it("keeps the intent when the wall is closed while the request is still in flight", () => {
    send.mockReturnValue(new Promise(() => undefined));
    openWall();
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
    dismiss();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toContain("a");
  });

  it("re-arms on the next trip: a fresh open that is cancelled clears again", async () => {
    openWall();
    await sendLink();
    dismiss();
    fireEvent.click(screen.getByRole("button", { name: ja.route.saveCta }));
    dismiss();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });
});

describe("the modal reports a dispatched send to its caller", () => {
  it("calls onSendCommitted once the request goes out, and not before", async () => {
    const onSendCommitted = vi.fn();
    renderWithLocale(<LoginModal open onClose={vi.fn()} onSendCommitted={onSendCommitted} />);
    expect(onSendCommitted).not.toHaveBeenCalled();
    await sendLink();
    expect(onSendCommitted).toHaveBeenCalledTimes(1);
  });

  /** A failed send still counts: the user asked for a link and may retry, and a
   * kept intent is bounded by consume-once + TTL while a cleared one is lost. */
  it("still reports a send that came back as an error", async () => {
    const onSendCommitted = vi.fn();
    send.mockResolvedValue("error");
    renderWithLocale(<LoginModal open onClose={vi.fn()} onSendCommitted={onSendCommitted} />);
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
    await waitFor(() => { expect(screen.getByRole("alert")).toBeTruthy(); });
    expect(onSendCommitted).toHaveBeenCalledTimes(1);
  });
});
