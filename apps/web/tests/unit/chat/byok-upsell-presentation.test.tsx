/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ByokUpsell } from "../../../src/features/chat/components/ByokUpsell";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { dictFor } from "../../../src/i18n/dictionaries";
import { LOCALES } from "../../../src/i18n/locales";
import { sendMagicLink } from "../../../src/lib/auth/neon-auth";
import { setLanguages } from "../_i18n";

vi.mock("../../../src/lib/auth/neon-auth", () => ({ sendMagicLink: vi.fn() }));
const dict = chatDictFor("zh"), byok = dict.byok, auth = dictFor("zh").auth;
beforeEach(() => { setLanguages(["zh"]); vi.mocked(sendMagicLink).mockReset(); });
afterEach(cleanup);

describe("BYOK explanation gives the setup decision its context", () => {
  it.each(LOCALES)("associates provider billing and the sign-in requirement with the action in %s", (locale) => {
    const localized = chatDictFor(locale), copy = localized.byok;
    render(<ByokUpsell dict={localized} />, { wrapper: LocaleProvider });
    const region = screen.getByRole("region", { name: copy.upsellTitle });
    const heading = within(region).getByRole("heading", { name: copy.upsellTitle });
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(within(region).getAllByRole("term").map(term => term.textContent)).toEqual([copy.upsellCostLabel, copy.upsellPrivacyLabel]);
    expect(within(region).getByText(copy.upsellPrivacy)).toBeTruthy();
    const button = within(region).getByRole("button", { name: copy.signInToSetUp });
    const described = (button.getAttribute("aria-describedby") ?? "").split(" ").map(id => document.getElementById(id)?.textContent).join(" ");
    expect(described).toContain(copy.upsellCost);
    expect(described).toContain(copy.upsellAccount);
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps accessible references local when more than one explanation is present", () => {
    render(<><ByokUpsell dict={dict} /><ByokUpsell dict={dict} /></>, { wrapper: LocaleProvider });
    const [first, second] = screen.getAllByRole("region", { name: byok.upsellTitle });
    expect(first?.getAttribute("aria-labelledby")).not.toBe(second?.getAttribute("aria-labelledby"));
    const [firstButton, secondButton] = screen.getAllByRole("button", { name: byok.signInToSetUp });
    expect(firstButton?.getAttribute("aria-describedby")).not.toBe(secondButton?.getAttribute("aria-describedby"));
  });
});

describe("email delivery does not complete BYOK setup", () => {
  it("keeps the original explanation and restores focus after an acknowledged sign-in email", async () => {
    vi.mocked(sendMagicLink).mockResolvedValue("sent");
    render(<ByokUpsell dict={dict} />, { wrapper: LocaleProvider });
    const region = screen.getByRole("region", { name: byok.upsellTitle });
    const button = within(region).getByRole("button", { name: byok.signInToSetUp });
    button.focus();
    fireEvent.click(button);
    fireEvent.change(screen.getByRole("textbox", { name: auth.email_label }), { target: { value: "fan@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: auth.title }));
    await screen.findByRole("heading", { name: auth.sent_title });
    expect(sendMagicLink).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: "http://localhost:3000/auth/callback?next=%2Fsettings%23api-key" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole("region", { name: byok.upsellTitle })).toBe(region);
    expect(screen.getByText(byok.upsellCost)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
