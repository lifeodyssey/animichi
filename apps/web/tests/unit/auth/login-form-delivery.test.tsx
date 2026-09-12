/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "../../../src/features/auth/ui/LoginForm";
import { sendMagicLink } from "../../../src/lib/auth/neon-auth";
import type { MagicLinkResult } from "../../../src/lib/auth/neon-auth";
import { dictFor } from "../../../src/i18n/dictionaries";
import { renderWithLocale, setLanguages } from "../_i18n";

vi.mock("../../../src/lib/auth/neon-auth", () => ({ sendMagicLink: vi.fn() }));
const send = vi.mocked(sendMagicLink), auth = dictFor("zh").auth;
beforeEach(() => { setLanguages(["zh"]); send.mockReset(); });
afterEach(cleanup);

function pendingLink() {
  let resolve!: (result: MagicLinkResult) => void;
  const promise = new Promise<MagicLinkResult>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function start(email = "Fan@Example.com", onSendCommitted = vi.fn()) {
  renderWithLocale(<LoginForm onSendCommitted={onSendCommitted} />);
  fireEvent.change(screen.getByRole("textbox", { name: auth.email_label }), { target: { value: email } });
  fireEvent.submit(screen.getByRole("form", { name: auth.title }));
}

describe("login delivery boundaries", () => {
  it("locks the recipient and rejects duplicate submits while a request is pending", async () => {
    const pending = pendingLink(), committed = vi.fn();
    send.mockReturnValue(pending.promise);
    start("Fan@Example.com", committed);
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.submit(screen.getByRole("form", { name: auth.title }));
    fireEvent.change(input, { target: { value: "different@example.com" } });
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe("Fan@Example.com");
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ email: "fan@example.com" }));
    expect(committed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => { pending.resolve("sent"); await pending.promise; });
    expect(screen.getByText("fan@example.com")).toBeTruthy();
    expect(screen.getByRole("heading", { name: auth.sent_title })).toBe(document.activeElement);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps the entered address after an unconfirmed delivery and allows retry", async () => {
    send.mockRejectedValueOnce(new Error("private transport detail")).mockResolvedValue("sent");
    start();
    expect((await screen.findByRole("alert")).textContent).toBe(auth.send_failed);
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("Fan@Example.com");
    expect(document.body.textContent).not.toContain("private transport detail");
    fireEvent.click(screen.getByRole("button", { name: auth.submit }));
    await screen.findByRole("status");
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("sent-email recovery", () => {
  it("keeps the acknowledged recipient during a resend and its failure", async () => {
    send.mockResolvedValueOnce("sent");
    start();
    await screen.findByRole("status");
    const pending = pendingLink();
    send.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: auth.resend }));
    expect(screen.getByText("fan@example.com")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: auth.resending }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: auth.change_email }).disabled).toBe(true);
    await act(async () => { pending.resolve({ error: "请稍后再试" }); await pending.promise; });
    expect(screen.getByRole("alert").textContent).toBe("请稍后再试");
    expect(screen.getByText("fan@example.com")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: auth.resend }).disabled).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("returns focus to the preserved email when editing and confirms only the new recipient", async () => {
    send.mockResolvedValue("sent");
    start();
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: auth.change_email }));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: auth.email_label });
    expect(input.value).toBe("Fan@Example.com");
    expect(input).toBe(document.activeElement);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(input, { target: { value: "new@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: auth.title }));
    await screen.findByRole("status");
    expect(screen.getByText("new@example.com")).toBeTruthy();
    expect(screen.queryByText("fan@example.com")).toBeNull();
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ email: "new@example.com" }));
  });
});

describe("field feedback", () => {
  it("associates a submitted error with the email and clears it when corrected", () => {
    start("not-an-email");
    const input = screen.getByRole<HTMLInputElement>("textbox");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    fireEvent.change(input, { target: { value: "fan@example.com" } });
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
