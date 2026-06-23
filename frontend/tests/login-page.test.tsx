import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(() => jaDict as Dict),
  useLocale: vi.fn(() => "ja"),
  useSetLocale: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    },
  })),
}));

vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>();
  return { ...actual, detectLocale: vi.fn(() => "ja") };
});

const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/login",
}));

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.delete("redirect");
    mockSearchParams.delete("error");
  });

  it("renders torii logo and brand name", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    render(<LoginPage />);

    expect(screen.getByText("聖地巡礼")).toBeDefined();
    expect(screen.getByText("Seichijunrei")).toBeDefined();
  });

  it("renders login form with email input and submit button", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    render(<LoginPage />);

    expect(screen.getByLabelText(jaDict.auth.email_label)).toBeDefined();
    expect(screen.getByRole("button", { name: jaDict.auth.btn_login })).toBeDefined();
  });

  it("renders login page subtitle", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    render(<LoginPage />);

    expect(screen.getByText(jaDict.auth.login_page_subtitle)).toBeDefined();
  });

  it("shows expired error when ?error=expired", async () => {
    mockSearchParams.set("error", "expired");
    vi.resetModules();

    // Re-mock after resetModules
    vi.doMock("@/lib/i18n-context", () => ({
      useDict: vi.fn(() => jaDict as Dict),
      useLocale: vi.fn(() => "ja"),
      useSetLocale: vi.fn(),
    }));
    vi.doMock("@/lib/supabase/browser", () => ({
      createClient: vi.fn(() => ({
        auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: null }) },
      })),
    }));
    vi.doMock("@/lib/i18n", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/i18n")>();
      return { ...actual, detectLocale: vi.fn(() => "ja") };
    });
    vi.doMock("next/navigation", () => ({
      useSearchParams: () => mockSearchParams,
      useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
      usePathname: () => "/login",
    }));

    const { default: LoginPage } = await import("@/app/login/page");
    render(<LoginPage />);

    expect(screen.getByText(jaDict.auth.link_expired_error)).toBeDefined();
  });

  it("renders back-to-home link", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    render(<LoginPage />);

    const backLink = screen.getByRole("link");
    expect(backLink.getAttribute("href")).toBe("/");
  });
});
