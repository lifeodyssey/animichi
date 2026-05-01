"use client";

import Link from "next/link";
import { useDict } from "../../lib/i18n-context";
import { cn } from "../../lib/utils";

interface SharedHeaderProps {
  onLogin?: () => void;
  loginHref?: string;
  position?: "sticky" | "fixed";
}

export default function SharedHeader({ onLogin, loginHref, position = "sticky" }: SharedHeaderProps) {
  const t = useDict().landing_hero.landing;

  return (
    <header
      className={cn(
        "inset-x-0 top-0 z-50 flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4 sm:px-8",
        position === "fixed" ? "fixed" : "sticky",
      )}
      style={{
        background: "var(--color-bg)",
        boxShadow: "0 1px 3px oklch(20% 0.02 240 / 0.04)",
        animation: "seichi-fade-down 0.5s ease-out",
      }}
    >
      <Link
        href="/"
        className="flex items-baseline gap-3"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        <span className="text-[28px] font-bold tracking-[0.02em] text-[var(--color-fg)]">
          聖地巡礼
        </span>
        <span className="text-[12px] tracking-[2px] text-[var(--color-muted-fg)]">
          seichijunrei
        </span>
      </Link>

      {onLogin && (
        <button
          type="button"
          onClick={onLogin}
          className="rounded-lg bg-[var(--color-primary)] px-5 py-2.5 text-[14px] font-medium text-[var(--color-primary-fg)] transition-opacity hover:opacity-90"
        >
          {t.login}
        </button>
      )}

      {!onLogin && loginHref && (
        <Link
          href={loginHref}
          className="rounded-lg bg-[var(--color-primary)] px-5 py-2.5 text-[14px] font-medium text-[var(--color-primary-fg)] transition-opacity hover:opacity-90"
        >
          {t.login}
        </Link>
      )}
    </header>
  );
}
