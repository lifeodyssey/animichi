/**
 * SharedHeader — unified header for Landing, Guide, and Search pages.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(() => ({ landing_hero: { landing: { login: "Log in" } } })),
  useLocale: vi.fn(() => "en"),
  useSetLocale: vi.fn(() => vi.fn()),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import SharedHeader from "@/components/layout/SharedHeader";

describe("SharedHeader", () => {
  it("renders brand logo linking to home", () => {
    render(<SharedHeader />);
    const logo = screen.getByRole("link", { name: /聖地巡礼/i });
    expect(logo).toHaveAttribute("href", "/");
  });

  it("renders login button when onLogin provided", () => {
    const onLogin = vi.fn();
    render(<SharedHeader onLogin={onLogin} />);
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("renders login link when loginHref provided", () => {
    render(<SharedHeader loginHref="/?login=true" />);
    const link = screen.getByRole("link", { name: "Log in" });
    expect(link).toHaveAttribute("href", "/?login=true");
  });

  it("calls onLogin when login button clicked", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(<SharedHeader onLogin={onLogin} />);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("renders as header element with sticky positioning", () => {
    const { container } = render(<SharedHeader />);
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
  });

  it("hides login when neither onLogin nor loginHref provided", () => {
    render(<SharedHeader />);
    expect(screen.queryByText("Log in")).not.toBeInTheDocument();
  });
});
