"use client";

import Link from "next/link";
import { useDict } from "../../lib/i18n-context";
import { cn } from "../../lib/utils";
import ToriiIcon from "../icons/ToriiIcon";
import { Button } from "@/components/ui/button";

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
        "entrance-down inset-x-0 top-0 z-50 px-4 sm:px-8",
        position === "fixed" ? "fixed pt-3" : "sticky",
      )}
    >
      <div className={cn(
        "mx-auto flex h-16 max-w-[1300px] items-center justify-between rounded-[var(--r-lg)] px-5",
        position === "fixed" ? "bg-card/80 border border-border/50 shadow-sm backdrop-blur-md" : "bg-card border-b-2 border-border",
      )}>
        {/* ── Left: torii logo + brand + nav ── */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2.5"
          >
            <ToriiIcon size={24} />
            <div className="flex flex-col">
              <span className="text-[10px] tracking-[1px] text-muted-foreground">
                Seichijunrei
              </span>
              <span className="font-display text-sm font-bold leading-tight text-foreground">
                聖地巡礼
              </span>
            </div>
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
          <Button
            type="primary"
            size="small"
            className="animal-btn-cta"
            onClick={onLogin}
          >
            {t.login}
          </Button>
        )}

        {!children && !onLogin && loginHref && (
          <Link href={loginHref}>
            <Button type="primary" size="small" className="animal-btn-cta">
              {t.login}
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
