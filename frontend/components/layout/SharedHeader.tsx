"use client";

import Link from "next/link";
import { useDict } from "../../lib/i18n-context";
import { cn } from "../../lib/utils";

export interface NavItem {
  label: string;
  href: string;
  active?: boolean;
}

interface SharedHeaderProps {
  onLogin?: () => void;
  loginHref?: string;
  position?: "sticky" | "fixed";
  navItems?: NavItem[];
}

export default function SharedHeader({
  onLogin,
  loginHref,
  position = "sticky",
  navItems,
}: SharedHeaderProps) {
  const t = useDict().landing_hero.landing;

  return (
    <header
      className={cn(
        "entrance-down inset-x-0 top-0 z-50 border-b border-border px-5 sm:px-8",
        position === "fixed" ? "fixed" : "sticky",
      )}
      style={{
        background: "var(--color-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between">
        {/* ── Left: logo + nav ── */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-baseline gap-2 font-display"
          >
            <span className="text-lg font-bold tracking-[0.02em] text-foreground">
              聖地巡礼
            </span>
            <span className="hidden text-xs tracking-[1.5px] text-muted-foreground sm:inline">
              seichijunrei
            </span>
          </Link>

          {navItems && navItems.length > 0 && (
            <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    item.active
                      ? "font-medium text-foreground bg-secondary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        {/* ── Right: login ── */}
        {onLogin && (
          <button
            type="button"
            onClick={onLogin}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
          >
            {t.login}
          </button>
        )}

        {!onLogin && loginHref && (
          <Link
            href={loginHref}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
          >
            {t.login}
          </Link>
        )}
      </div>
    </header>
  );
}
