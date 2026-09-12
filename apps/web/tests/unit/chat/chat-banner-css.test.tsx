/**
 * @vitest-environment jsdom
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBanner } from "../../../src/features/chat/components/ErrorBanner";
import { BudgetExhausted } from "../../../src/features/chat/components/ErrorStates/BudgetExhausted";
import { QuotaExhausted } from "../../../src/features/chat/components/ErrorStates/QuotaExhausted";
import { SessionExpired } from "../../../src/features/chat/components/ErrorStates/SessionExpired";
import { StreamInterruption } from "../../../src/features/chat/components/ErrorStates/StreamInterruption";
import { TurnFailure } from "../../../src/features/chat/components/ErrorStates/TurnFailure";
import { chatDictFor } from "../../../src/features/chat/i18n";
import chatCss from "../../../src/styles/chat.css?raw";
import { renderWithLocale, setLanguages } from "../_i18n";
import { ruleDeclaration } from "../stylesheet-probe";

const dict = chatDictFor("ja");

const GEOMETRY = ["flex", "flex-wrap", "items-center", "gap-3", "rounded-[14px]", "border-l-4", "px-4", "py-2.5", "text-sm", "font-medium"];
const ERROR = ["border-error-strong", "bg-error-bg", "text-error-strong"];

beforeEach(() => { setLanguages(["ja"]); });
afterEach(cleanup);

function expectNotice(el: Element, block: string, tone: readonly string[]): void {
  expect(el.className.split(/\s+/u)).toEqual(expect.arrayContaining([block, ...GEOMETRY, ...tone]));
}

function mustFind(selector: string): Element {
  const el = document.querySelector(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  return el;
}

function byokView(state: "D13" | "D14") {
  return { state, onRetry: vi.fn(), onExpiredResume: vi.fn(), recovering: false } as const;
}

describe("the inline notice family shares one geometry, toned per intent", () => {
  it("the shared budget notice has one status and separate login and explanation actions", () => {
    renderWithLocale(<BudgetExhausted dict={dict} />);
    expect(screen.getByRole("status").textContent).toContain(dict.errorStates.d11Message);
    expect(screen.getByRole("button", { name: dict.errorStates.d11Login })).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.byok.d11UseOwnKey }).getAttribute("aria-expanded")).toBe("false");
  });

  it("the interruption reports its state with one retry action", () => {
    renderWithLocale(<StreamInterruption state="D10" dict={dict} onRetry={vi.fn()} />);
    const strip = screen.getByRole("alert");
    expect(strip.textContent).toContain(dict.errorStates.d10Message);
    expect(strip.getAttribute("data-state")).toBe("D10");
    expect(screen.getByRole("button", { name: dict.errorStates.d10Retry })).toBeTruthy();
  });

  it("the generic failure keeps its reportable code beside the existing page banner", () => {
    renderWithLocale(
      <>
        <StreamInterruption state="D18" dict={dict} onRetry={vi.fn()} errorCode="boom" />
        <ErrorBanner dict={dict} onRetry={vi.fn()} />
      </>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(mustFind(".chat-interruption").textContent).toContain(dict.errorStates.d18Message.replace("{code}", "boom"));
    expectNotice(mustFind(".chat-error-banner"), "chat-error-banner", ERROR);
  });

  it("the BYOK gate announces the account requirement with one setup action", () => {
    renderWithLocale(<TurnFailure view={byokView("D13")} dict={dict} locale="ja" />);
    expect(screen.getByRole("alert").textContent).toContain(dict.byok.errorRequiresLogin);
    expect(screen.getByText(dict.byok.upsellCost)).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: dict.byok.signInToSetUp }).getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("the rejected-key alert describes its native settings link", () => {
    renderWithLocale(<TurnFailure view={byokView("D14")} dict={dict} locale="ja" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(dict.byok.notAcceptedTitle);
    const link = screen.getByRole("link", { name: dict.byok.openSettings });
    expect(link.getAttribute("aria-describedby")).toBe(alert.id);
    expect(link.className).toContain("animal-btn");
    expect(link.getAttribute("href")).toContain("/settings");
  });
});

describe("notice actions use Animal Island button styles", () => {
  it.each([
    [".chat-session-expired__login", <SessionExpired key="a" dict={dict} onResume={vi.fn()} />],
    [".chat-session-expired__resume", <SessionExpired key="b" dict={dict} onResume={vi.fn()} />],
    [".chat-quota-exhausted__login", <QuotaExhausted key="c" dict={dict} locale="ja" resetsAtMs={undefined} />],
    [".chat-interruption__retry", <StreamInterruption key="d" state="D4" dict={dict} onRetry={vi.fn()} />],
    [".chat-error-banner__retry", <ErrorBanner key="e" dict={dict} onRetry={vi.fn()} />],
  ])("renders %s as an animal-btn, not a bespoke press rule", (hook, element) => {
    renderWithLocale(element);
    expect(document.querySelector(hook)?.className).toContain("animal-btn");
  });
});

describe("S1.9 Turnstile full-viewport entry", () => {
  it("covers the viewport with semantic surfaces", () => {
    expect(ruleDeclaration(chatCss, ".turnstile-entry", "position")).toBe("fixed");
    expect(ruleDeclaration(chatCss, ".turnstile-entry", "inset")).toBe("0");
    expect(ruleDeclaration(chatCss, ".turnstile-entry", "min-height")).toBe("100dvh");
    expect(ruleDeclaration(chatCss, ".turnstile-entry", "background")).toBe("var(--color-bg)");
  });

  it("centres the bounded challenge card above app content", () => {
    expect(ruleDeclaration(chatCss, ".turnstile-entry", "z-index")).toBe("100");
    expect(ruleDeclaration(chatCss, ".turnstile-entry", "place-items")).toBe("center");
  });

  it("keeps the page's missing-key fallback retry styles", () => {
    expect(ruleDeclaration(chatCss, ".turnstile-gate__retry", "background")).toBe("var(--color-primary)");
    expect(ruleDeclaration(chatCss, ".turnstile-gate__retry", "box-shadow")).toBe("0 3px 0 var(--shadow-3d)");
  });
});
