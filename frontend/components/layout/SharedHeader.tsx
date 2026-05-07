"use client";

import Link from "next/link";
import { useDict } from "../../lib/i18n-context";
import { cn } from "../../lib/utils";
import ToriiIcon from "../icons/ToriiIcon";

export interface NavItem {
  label: string;
  href: string;
  active?: boolean;
}

interface SharedHeaderProps {
  /** Custom content for the right side of the header. */
  children?: React.ReactNode;
  /** Login button callback (landing page). */
  onLogin?: () => void;
  /** Login link href (search/anime pages). */
  loginHref?: string;
  /** Sticky (scrolls with content) or fixed (always on top). */
  position?: "sticky" | "fixed";
  /** Navigation items (guide pages). */
  navItems?: NavItem[];
}

/**
 * SharedHeader — site-wide header with torii logo + brand name.
 *
 * Used on all pages (landing, guide, login, chat). The right side
 * is customizable via children — public pages pass login buttons,
 * chat page passes New/History/Settings.
 */
export default function SharedHeader({
  children,
  onLogin,
  loginHref,
  position = "sticky",
  navItems,
}: SharedHeaderProps) {
  const t = useDict().landing_hero.landing;

  return (
    <header
      className={cn(
        "entrance-down inset-x-0 top-0 z-50 border-b border-border bg-card px-4 sm:px-6",
        position === "fixed" ? "fixed" : "sticky",
      )}
    >
      <div className="mx-auto flex h-12 items-center justify-between">
        {/* ── Left: torii logo + brand + nav ── */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-display"
          >
            <ToriiIcon size={20} />
            <span className="text-sm font-bold text-foreground">
              聖地巡礼
            </span>
            <span className="hidden text-[10px] tracking-[1.2px] text-muted-foreground sm:inline">
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

        {/* ── Right: children or login ── */}
        {children && (
          <div className="flex items-center gap-1.5">
            {children}
          </div>
        )}

        {!children && onLogin && (
          <button
            type="button"
            onClick={onLogin}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
          >
            {t.login}
          </button>
        )}

        {!children && !onLogin && loginHref && (
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
