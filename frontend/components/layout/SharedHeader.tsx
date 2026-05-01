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
        "inset-x-0 top-0 z-50 border-b border-[var(--color-border)] px-5 sm:px-8",
        position === "fixed" ? "fixed" : "sticky",
      )}
      style={{
        background: "var(--color-card)",
        boxShadow: "0 1px 3px oklch(20% 0.02 240 / 0.04)",
        animation: "seichi-fade-down 0.5s ease-out",
      }}
    >
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between">
        {/* ── Left: logo + nav ── */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-baseline gap-2"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            <span className="text-lg font-bold tracking-[0.02em] text-[var(--color-fg)]">
              聖地巡礼
            </span>
            <span className="hidden text-xs tracking-[1.5px] text-[var(--color-muted-fg)] sm:inline">
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
                      ? "font-medium text-[var(--color-fg)] bg-[var(--color-secondary)]"
                      : "text-[var(--color-muted-fg)] hover:text-[var(--color-fg)] hover:bg-[var(--color-secondary)]",
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
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-fg)] transition-opacity hover:opacity-90"
          >
            {t.login}
          </button>
        )}

        {!onLogin && loginHref && (
          <Link
            href={loginHref}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-fg)] transition-opacity hover:opacity-90"
          >
            {t.login}
          </Link>
        )}
      </div>
    </header>
  );
}
