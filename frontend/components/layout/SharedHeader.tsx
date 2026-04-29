"use client";

import Link from "next/link";
import { useDict } from "../../lib/i18n-context";

interface SharedHeaderProps {
  onLogin?: () => void;
  loginHref?: string;
}

export default function SharedHeader({ onLogin, loginHref }: SharedHeaderProps) {
  const t = useDict().landing_hero.landing;

  return (
    <header
      className="sticky top-0 z-50 flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4 sm:px-8"
      style={{
        background: "var(--color-bg)",
        boxShadow: "0 1px 3px oklch(20% 0.02 238 / 0.04)",
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
          className="rounded-lg px-5 py-2.5 text-[14px] font-medium text-[var(--color-fg)] transition-colors hover:bg-[var(--color-card)]"
          style={{ border: "1px solid color-mix(in oklch, var(--color-border) 60%, transparent)" }}
        >
          {t.login}
        </button>
      )}

      {!onLogin && loginHref && (
        <Link
          href={loginHref}
          className="rounded-lg px-5 py-2.5 text-[14px] font-medium text-[var(--color-fg)] transition-colors hover:bg-[var(--color-card)]"
          style={{ border: "1px solid color-mix(in oklch, var(--color-border) 60%, transparent)" }}
        >
          {t.login}
        </Link>
      )}
    </header>
  );
}
