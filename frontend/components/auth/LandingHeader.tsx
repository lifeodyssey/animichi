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
      <div className="mx-auto flex h-[78px] max-w-[1200px] items-center justify-between rounded-full border-2 border-border bg-card pl-6 pr-4 shadow-[0_8px_26px_-12px_rgba(66,50,30,0.5)] backdrop-blur-md sm:pl-8 sm:pr-5">
        <a href="#top" className="flex items-center gap-3">
          <Image
            src="/images/logo/logo.png"
            alt="聖地巡礼"
            width={54}
            height={54}
            priority
            className="shrink-0"
          />
          <span className="font-display text-[24px] font-bold leading-none text-fg-heading">
            聖地巡礼
          </span>
        </a>

        <button
          type="button"
          onClick={onLogin}
          className="flex items-center gap-1.5 rounded-[50px] border border-border bg-card px-5 py-2.5 text-[14px] font-bold text-fg shadow-3d-sm transition-transform duration-150 hover:-translate-y-px active:translate-y-px"
        >
          <User size={15} aria-hidden="true" />
          {t.login}
        </button>
      </div>
    </header>
  );
}
