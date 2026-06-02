"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDict } from "../../lib/i18n-context";
import { cn } from "../../lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { APP_NAV_ITEMS, isNavActive } from "@/lib/nav";
import { MenuIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** variant="app" — logged-in states (05/08/10/14/15): 4-item nav from constant.
 *  variant="guest" — landing + public pages: login CTA instead of nav.
 *  Omitting variant keeps full backward compat via children. */
export type HeaderVariant = "app" | "guest";

export interface NavItem {
  label: string;
  href: string;
  active?: boolean;
}

interface SharedHeaderProps {
  variant?: HeaderVariant;
  /** Custom content for the right side of the header. */
  children?: React.ReactNode;
  /** Login button callback (guest variant). */
  onLogin?: () => void;
  /** Login link href (guest variant, no callback). */
  loginHref?: string;
  /** Sticky (scrolls with content) or fixed (always on top). */
  position?: "sticky" | "fixed";
  /** Legacy: explicit nav items (guide pages). Prefer variant="app". */
  navItems?: NavItem[];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NavLinks({
  pathname,
  dict,
  className,
}: {
  pathname: string;
  dict: ReturnType<typeof useDict>;
  className?: string;
}) {
  return (
    <nav
      aria-label="Main"
      className={cn("flex items-center gap-1", className)}
    >
      {APP_NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item.href);
        const label = dict.app_nav[item.key];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-fg"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function MobileMenuSheet({
  pathname,
  dict,
}: {
  pathname: string;
  dict: ReturnType<typeof useDict>;
}) {
  return (
    <Sheet>
      <SheetTrigger
        aria-label={dict.app_nav.menu}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
      >
        <MenuIcon size={18} aria-hidden />
      </SheetTrigger>
      <SheetContent side="right" className="w-[240px] pt-12">
        <SheetHeader>
          <SheetTitle className="sr-only">{dict.app_nav.menu}</SheetTitle>
        </SheetHeader>
        <nav aria-label="Mobile main" className="flex flex-col gap-1 px-2">
          {APP_NAV_ITEMS.map((item) => {
            const active = isNavActive(pathname, item.href);
            const label = dict.app_nav[item.key];
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-4 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-fg"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

function LoginCTA({
  onLogin,
  loginHref,
  label,
}: {
  onLogin?: () => void;
  loginHref?: string;
  label: string;
}) {
  if (onLogin) {
    return (
      <Button type="default" size="small" onClick={onLogin}>
        {label}
      </Button>
    );
  }
  if (loginHref) {
    return (
      <Link href={loginHref}>
        <Button type="default" size="small">
          {label}
        </Button>
      </Link>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// SharedHeader — unified site header
// ---------------------------------------------------------------------------

/**
 * SharedHeader — single header component for all pages.
 *
 * variant="app"   → 4-item nav (マップ/スポット/旅の記録/コレクション) with active
 *                   route highlight. Active computed via usePathname. Mobile: Sheet drawer.
 * variant="guest" → logo only on left + login CTA on right. No nav links.
 * (none)          → legacy mode: accepts children / navItems / loginHref.
 */
export default function SharedHeader({
  variant,
  children,
  onLogin,
  loginHref,
  position = "sticky",
  navItems,
}: SharedHeaderProps) {
  const dict = useDict();
  const pathname = usePathname() ?? "";
  const loginLabel = dict.landing_hero.landing.login;

  const isApp = variant === "app";
  const isGuest = variant === "guest";

  return (
    <header
      className={cn(
        "entrance-down inset-x-0 top-0 z-50 px-4 sm:px-8",
        position === "fixed" ? "fixed pt-3" : "sticky",
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-16 max-w-[1300px] items-center justify-between rounded-[var(--r-lg)] px-5",
          position === "fixed"
            ? "border border-border/50 bg-card/80 shadow-sm backdrop-blur-md"
            : "border-b-2 border-border bg-card",
        )}
      >
        {/* ── Left: logo + (app) desktop nav ── */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/images/logo/logo.png"
              alt=""
              width={30}
              height={30}
              className="shrink-0"
            />
            <div className="flex flex-col">
              <span className="text-[10px] tracking-[1px] text-muted-foreground">
                Seichijunrei
              </span>
              <span className="font-display text-sm font-bold leading-tight text-foreground">
                聖地巡礼
              </span>
            </div>
          </Link>

          {/* App variant — desktop nav (hidden on mobile, shown sm+) */}
          {isApp && (
            <NavLinks
              pathname={pathname}
              dict={dict}
              className="hidden sm:flex"
            />
          )}

          {/* Legacy navItems support */}
          {!isApp && !isGuest && navItems && navItems.length > 0 && (
            <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    item.active
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        {/* ── Right: actions ── */}
        <div className="flex items-center gap-1.5">
          {/* Children passthrough (AppShell injects new-chat button) */}
          {children}

          {/* App variant — login CTA hidden, mobile menu shown */}
          {isApp && <MobileMenuSheet pathname={pathname} dict={dict} />}

          {/* Guest variant — login CTA */}
          {isGuest && (
            <LoginCTA onLogin={onLogin} loginHref={loginHref} label={loginLabel} />
          )}

          {/* Legacy: show login when no variant + no children */}
          {!variant && !children && (onLogin || loginHref) && (
            <LoginCTA onLogin={onLogin} loginHref={loginHref} label={loginLabel} />
          )}
        </div>
      </div>
    </header>
  );
}
