/**
 * SharedHeader — unified header for all pages.
 * TDD: tests written first per /impeccable craft + /frontend-tdd.
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
  // ── Brand ──
  it("renders brand logo linking to home", () => {
    render(<SharedHeader />);
    const logo = screen.getByRole("link", { name: /聖地巡礼/i });
    expect(logo).toHaveAttribute("href", "/");
  });

  it("renders brand tagline 'Seichijunrei'", () => {
    render(<SharedHeader />);
    expect(screen.getByText("Seichijunrei")).toBeInTheDocument();
  });

  // ── Login button ──
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

  it("hides login when neither onLogin nor loginHref provided", () => {
    render(<SharedHeader />);
    expect(screen.queryByText("Log in")).not.toBeInTheDocument();
  });

  // ── Structure ──
  it("renders as header element", () => {
    const { container } = render(<SharedHeader />);
    expect(container.querySelector("header")).not.toBeNull();
  });

  it("uses sticky positioning by default", () => {
    const { container } = render(<SharedHeader />);
    const header = container.querySelector("header");
    expect(header?.className).toContain("sticky");
  });

  it("uses fixed positioning when position='fixed'", () => {
    const { container } = render(<SharedHeader position="fixed" />);
    const header = container.querySelector("header");
    expect(header?.className).toContain("fixed");
  });

  // ── Navigation ──
  it("renders nav links when provided", () => {
    render(
      <SharedHeader
        navItems={[
          { label: "Guide", href: "/anime/123", active: true },
          { label: "Map", href: "/map" },
        ]}
      />,
    );
    expect(screen.getByText("Guide")).toBeInTheDocument();
    expect(screen.getByText("Map")).toBeInTheDocument();
  });

  it("marks active nav item", () => {
    render(
      <SharedHeader
        navItems={[
          { label: "Guide", href: "/anime/123", active: true },
          { label: "Map", href: "/map" },
        ]}
      />,
    );
    const guideLink = screen.getByText("Guide").closest("a");
    expect(guideLink?.getAttribute("aria-current")).toBe("page");
  });

  it("does not render nav when no navItems provided", () => {
    render(<SharedHeader />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
