"use client";

import { User } from "lucide-react";
import Image from "next/image";
import { useDict } from "../../lib/i18n-context";

interface LandingHeaderProps {
  onLogin: () => void;
}

/**
 * Landing header — a large, floating, rounded warm pill: the torii+fox logo and
 * serif wordmark on the left, a single cream Log in pill on the right. Section
 * nav links are intentionally omitted until those destinations exist. Library tokens.
 */
export default function LandingHeader({ onLogin }: LandingHeaderProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;

  return (
    <header className="sticky top-0 z-50 px-4 pt-3 sm:px-5">
      <div className="mx-auto flex h-[84px] max-w-[1280px] items-center justify-between rounded-full border-2 border-border bg-card pl-6 pr-4 shadow-[0_8px_26px_-12px_rgba(66,50,30,0.5)] backdrop-blur-md sm:pl-8 sm:pr-5">
        <a href="#top" className="flex items-center gap-3">
          <Image
            src="/images/logo/logo.png"
            alt="聖地巡礼"
            width={60}
            height={60}
            priority
            className="shrink-0"
          />
          <span className="font-display text-[27px] font-bold leading-none text-fg-heading">
            聖地巡礼
          </span>
        </a>

        <button
          type="button"
          onClick={onLogin}
          className="flex items-center gap-1.5 rounded-[50px] bg-focus px-6 py-3 text-[15px] font-extrabold text-fg-heading shadow-[0_4px_0_0_var(--color-focus-dark)] transition-transform duration-150 hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_0_var(--color-focus-dark)]"
        >
          <User size={16} aria-hidden="true" />
          {t.login}
        </button>
      </div>
    </header>
  );
}
