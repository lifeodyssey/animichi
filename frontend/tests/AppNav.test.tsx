/**
 * Task D1 — Unified app header + nav
 * Tests covering all 5 ACs:
 *   AC1 (Happy) — all app states render same 4 items from shared constant
 *   AC2 (Boundary) — active route highlighted; guest shows login CTA not nav
 *   AC3 (Error) — unknown route does not throw
 *   AC4 (i18n) — nav labels localised ja/en/zh
 *   AC5 (Responsive) — mobile nav renders inside Sheet trigger, no logo overlap
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Static helpers (no React) ──────────────────────────────────────────────
import { APP_NAV_ITEMS, isNavActive } from "@/lib/nav";

// ── Mocks ─────────────────────────────────────────────────────────────────

let mockPathname = "/chat";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let mockDict = {
  landing_hero: { landing: { login: "Log in" } },
  app_nav: {
    map: "マップ",
    spots: "スポット",
    records: "旅の記録",
    collection: "コレクション",
    menu: "メニュー",
    close: "閉じる",
  },
};

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => mockDict,
  useLocale: vi.fn(() => "ja"),
  useSetLocale: vi.fn(() => vi.fn()),
}));

import SharedHeader from "@/components/layout/SharedHeader";

// ── AC3 helper — pure function tests (no React, no errors thrown) ──────────
describe("isNavActive (AC3 — unknown route safety)", () => {
  it("returns false for empty pathname", () => {
    expect(isNavActive("", "/chat")).toBe(false);
  });

  it("returns true for exact match", () => {
    expect(isNavActive("/chat", "/chat")).toBe(true);
  });

  it("returns true for sub-path", () => {
    expect(isNavActive("/chat/room/123", "/chat")).toBe(true);
  });

  it("returns false for unrelated path", () => {
    expect(isNavActive("/collection", "/chat")).toBe(false);
  });

  it("does not throw for any arbitrary string", () => {
    expect(() => isNavActive("/totally/unknown/xyz/abc", "/chat")).not.toThrow();
    expect(isNavActive("/totally/unknown/xyz/abc", "/chat")).toBe(false);
  });
});

// ── AC1 — Shared constant integrity ────────────────────────────────────────
describe("APP_NAV_ITEMS constant (AC1 — single source of truth)", () => {
  it("exports exactly 4 items", () => {
    expect(APP_NAV_ITEMS).toHaveLength(4);
  });

  it("contains マップ, スポット, 旅の記録, コレクション keys", () => {
    const keys = APP_NAV_ITEMS.map((n) => n.key);
    expect(keys).toContain("map");
    expect(keys).toContain("spots");
    expect(keys).toContain("records");
    expect(keys).toContain("collection");
  });

  it("maps /chat to map, /search to spots", () => {
    const map = APP_NAV_ITEMS.find((n) => n.key === "map");
    const spots = APP_NAV_ITEMS.find((n) => n.key === "spots");
    expect(map?.href).toBe("/chat");
    expect(spots?.href).toBe("/search");
  });
});

// ── AC1 — App header renders 4 nav items ──────────────────────────────────
describe("SharedHeader variant=app (AC1 — 4-item nav)", () => {
  it("renders all 4 app nav labels", () => {
    render(<SharedHeader variant="app" />);
    expect(screen.getByText("マップ")).toBeInTheDocument();
    expect(screen.getByText("スポット")).toBeInTheDocument();
    expect(screen.getByText("旅の記録")).toBeInTheDocument();
    expect(screen.getByText("コレクション")).toBeInTheDocument();
  });

  it("renders a <nav> element with aria-label", () => {
    render(<SharedHeader variant="app" />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("renders brand logo even in app variant", () => {
    render(<SharedHeader variant="app" />);
    expect(screen.getByRole("link", { name: /聖地巡礼/i })).toBeInTheDocument();
  });
});

// ── AC2 — Active route highlighted ────────────────────────────────────────
describe("SharedHeader active route (AC2 — highlight)", () => {
  it("marks /chat nav link as aria-current=page when pathname is /chat", () => {
    mockPathname = "/chat";
    render(<SharedHeader variant="app" />);
    const mapLink = screen.getByRole("link", { name: "マップ" });
    expect(mapLink).toHaveAttribute("aria-current", "page");
  });

  it("does not mark /search as active when pathname is /chat", () => {
    mockPathname = "/chat";
    render(<SharedHeader variant="app" />);
    const spotsLink = screen.getByRole("link", { name: "スポット" });
    expect(spotsLink).not.toHaveAttribute("aria-current", "page");
  });

  it("marks /search as active when pathname is /search", () => {
    mockPathname = "/search";
    render(<SharedHeader variant="app" />);
    const spotsLink = screen.getByRole("link", { name: "スポット" });
    expect(spotsLink).toHaveAttribute("aria-current", "page");
  });
});

// ── AC2 — Guest header shows login CTA, NOT app nav ───────────────────────
describe("SharedHeader variant=guest (AC2 — login CTA)", () => {
  it("does not render app nav links", () => {
    render(<SharedHeader variant="guest" onLogin={vi.fn()} />);
    expect(screen.queryByText("マップ")).not.toBeInTheDocument();
    expect(screen.queryByText("スポット")).not.toBeInTheDocument();
  });

  it("renders login button when onLogin provided", () => {
    const onLogin = vi.fn();
    render(<SharedHeader variant="guest" onLogin={onLogin} />);
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("calls onLogin when button clicked", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(<SharedHeader variant="guest" onLogin={onLogin} />);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("renders login link when loginHref provided (no onLogin)", () => {
    render(<SharedHeader variant="guest" loginHref="/?login=true" />);
    const link = screen.getByRole("link", { name: "Log in" });
    expect(link).toHaveAttribute("href", "/?login=true");
  });
});

// ── AC4 — i18n: labels use dict values for en/zh ─────────────────────────
describe("SharedHeader i18n (AC4 — locale labels)", () => {
  it("renders English nav labels when dict has English values", () => {
    mockDict = {
      landing_hero: { landing: { login: "Log in" } },
      app_nav: {
        map: "Map",
        spots: "Spots",
        records: "Trip Records",
        collection: "Collection",
        menu: "Menu",
        close: "Close",
      },
    };
    render(<SharedHeader variant="app" />);
    expect(screen.getByText("Map")).toBeInTheDocument();
    expect(screen.getByText("Spots")).toBeInTheDocument();
    expect(screen.getByText("Trip Records")).toBeInTheDocument();
    expect(screen.getByText("Collection")).toBeInTheDocument();
  });

  it("renders Chinese nav labels when dict has Chinese values", () => {
    mockDict = {
      landing_hero: { landing: { login: "登录" } },
      app_nav: {
        map: "地图",
        spots: "景点",
        records: "旅行记录",
        collection: "收藏",
        menu: "菜单",
        close: "关闭",
      },
    };
    render(<SharedHeader variant="app" />);
    expect(screen.getByText("地图")).toBeInTheDocument();
    expect(screen.getByText("景点")).toBeInTheDocument();
    expect(screen.getByText("旅行记录")).toBeInTheDocument();
    expect(screen.getByText("收藏")).toBeInTheDocument();
  });
});

// ── AC5 — Responsive: mobile menu button present ──────────────────────────
describe("SharedHeader responsive (AC5 — mobile menu)", () => {
  it("renders a mobile menu button with accessible label", () => {
    render(<SharedHeader variant="app" />);
    expect(
      screen.getByRole("button", { name: /メニュー|menu|菜单/i }),
    ).toBeInTheDocument();
  });

  it("desktop nav is visually hidden on mobile (hidden class)", () => {
    const { container } = render(<SharedHeader variant="app" />);
    const desktopNav = container.querySelector("nav[aria-label]");
    expect(desktopNav?.className).toMatch(/hidden/);
  });
});

// ── Legacy compatibility (children prop still works) ──────────────────────
describe("SharedHeader children passthrough", () => {
  it("renders children when provided (app variant)", () => {
    render(
      <SharedHeader variant="app">
        <button type="button">Custom action</button>
      </SharedHeader>,
    );
    expect(
      screen.getByRole("button", { name: "Custom action" }),
    ).toBeInTheDocument();
  });
});
