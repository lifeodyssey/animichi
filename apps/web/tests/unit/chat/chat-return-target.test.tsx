/**
 * @vitest-environment jsdom
 *
 * #507 review P1-1: migrating the sessions is only half a fix. `/chat?session=`
 * is the ONLY entry that reads a migrated session back — there is no session or
 * route list — and all three in-chat login walls passed no return target, so
 * `sanitizeReturnTarget(undefined)` sent every visitor to `/` after a correct
 * migration. These pin the target at each wall.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LimitBanner } from "../../../src/features/chat/components/ErrorStates/LimitBanner";
import { TimedItinerary } from "../../../src/features/chat/components/TimedItinerary";
import { itineraryView } from "../../../src/lib/chat/itinerary";
import { ujiItinerary } from "./_route-fixtures";
import { SessionExpired } from "../../../src/features/chat/components/ErrorStates/SessionExpired";
import { ChatReturnTargetProvider, chatSessionTarget, returnTargetNamesSession } from "../../../src/features/chat/return-target";
import { carriesPanelIntent } from "../../../src/lib/auth/returnTarget";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { sendMagicLink } from "../../../src/lib/auth/neonAuth";
import { setLanguages } from "../_i18n";
import { LocaleProvider } from "../../../src/i18n/context";

vi.mock("../../../src/lib/auth/neonAuth", () => ({ sendMagicLink: vi.fn() }));
const send = vi.mocked(sendMagicLink);

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SESSION = "sess-abc-123";
const dict = chatDictFor("ja");

// No default: passing `undefined` explicitly must MEAN "no session", which a
// default parameter would silently overwrite with SESSION.
function inChat(node: React.ReactNode, sessionId: string | undefined) {
  return render(
    <LocaleProvider>
      <ChatReturnTargetProvider sessionIdOf={() => sessionId}>{node}</ChatReturnTargetProvider>
    </LocaleProvider>,
  );
}

describe("chatSessionTarget", () => {
  it("builds the one entry that reads a migrated session back", () => {
    expect(chatSessionTarget(SESSION)).toBe(`/chat?session=${SESSION}`);
  });

  it("percent-encodes an id so the target cannot grow a second parameter", () => {
    expect(chatSessionTarget("a&next=/evil")).toBe("/chat?session=a%26next%3D%2Fevil");
  });

  it("yields nothing when there is no session to return to", () => {
    expect(chatSessionTarget(undefined)).toBeUndefined();
    expect(chatSessionTarget("")).toBeUndefined();
  });
});

describe("returnTargetNamesSession", () => {
  it("recognises a session return, which makes a no-op migration an anomaly", () => {
    expect(returnTargetNamesSession(`/chat?session=${SESSION}`)).toBe(true);
  });

  it("does not fire for the BYOK deep-link or a bare path", () => {
    expect(returnTargetNamesSession("/chat?settings=byok")).toBe(false);
    expect(returnTargetNamesSession("/chat")).toBe(false);
    expect(returnTargetNamesSession(undefined)).toBe(false);
  });
});

describe("carriesPanelIntent (#480 reconciliation)", () => {
  it("stays true for the BYOK target, preserving #480's navigate-on-save-failure", () => {
    expect(carriesPanelIntent("/chat?settings=byok")).toBe(true);
  });

  it("is false for a plain session return, so the save retry surface survives", () => {
    expect(carriesPanelIntent(`/chat?session=${SESSION}`)).toBe(false);
  });

  it("is false for anything the open-redirect guard rejects", () => {
    expect(carriesPanelIntent("https://evil.test?settings=byok")).toBe(false);
  });
});

describe("the in-chat login walls carry the session back", () => {
  function submitFrom(node: React.ReactNode, openLabel: string): void {
    send.mockResolvedValue("sent");
    inChat(node, SESSION);
    fireEvent.click(screen.getByRole("button", { name: openLabel }));
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
  }

  const EXPECTED = `http://localhost:3000/auth/callback?next=%2Fchat%3Fsession%3D${SESSION}`;

  it("D11/D12 limit banner sends the visitor back to the session, not to `/`", () => {
    submitFrom(<LimitBanner block="chat-quota" message="quota" loginLabel="login" />, "login");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: EXPECTED }));
  });

  it("D8 session-expiry banner sends the visitor back to the session, not to `/`", () => {
    submitFrom(<SessionExpired dict={dict} onResume={() => undefined} />, dict.errorStates.d8Login);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: EXPECTED }));
  });

  it("P5 save wall — the #507 headline journey — returns to the session", () => {
    submitFrom(
      <TimedItinerary
        view={itineraryView(ujiItinerary())}
        dict={dict}
        save={{ pointIds: ["a", "b"], title: "宇治" }}
        saveDeps={{ authStatus: "anonymous", request: vi.fn() }}
      />,
      dict.route.saveCta,
    );
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: EXPECTED }));
  });

  it("keeps today's bare callback URL when there is no session to return to", () => {
    send.mockResolvedValue("sent");
    inChat(<LimitBanner block="chat-quota" message="quota" loginLabel="login" />, undefined);
    fireEvent.click(screen.getByRole("button", { name: "login" }));
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      callbackURL: "http://localhost:3000/auth/callback",
    }));
  });
});
