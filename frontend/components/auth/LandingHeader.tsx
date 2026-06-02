"use client";

import { User } from "lucide-react";
import Image from "next/image";
import { useDict } from "../../lib/i18n-context";

interface LandingHeaderProps {
  onLogin: () => void;
}

const NAV = [
  { href: "#how-it-works", label: "Explore" },
  { href: "#popular-routes", label: "Guides" },
  { href: "#save-sync", label: "My Journal" },
] as const;

/**
 * Landing header — built to the locked blueprint: a floating, rounded, warm bar
 * (not flush), a subtle cream torii square + serif wordmark, nav links, and a
 * cream Log in pill with a person icon. Library color tokens.
 */
export default function LandingHeader({ onLogin }: LandingHeaderProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;

  return (
    <header className="sticky top-0 z-50 px-4 pt-3 sm:px-5">
      <div className="mx-auto flex h-[60px] max-w-[1200px] items-center justify-between rounded-[20px] border border-border bg-[var(--animal-bg-color-content)] pl-4 pr-3 shadow-[0_6px_22px_-10px_rgba(66,50,30,0.45)] backdrop-blur-md sm:pl-6 sm:pr-4">
        <a href="#top" className="flex items-center gap-2.5">
          <Image
            src="/images/logo/logo.png"
            alt="聖地巡礼"
            width={40}
            height={40}
            priority
            className="shrink-0"
          />
          <span className="font-display text-[21px] font-bold leading-none text-fg-heading">
            聖地巡礼
          </span>
        </a>

        <div className="flex items-center gap-5 sm:gap-8">
          <nav aria-label="Landing" className="flex items-center gap-5 sm:gap-7">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-[15px] font-semibold text-fg transition-colors hover:text-primary"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            onClick={onLogin}
            className="flex items-center gap-1.5 rounded-[50px] border border-border bg-card px-4 py-2 text-[14px] font-bold text-fg shadow-3d-sm transition-transform duration-150 hover:-translate-y-px active:translate-y-px"
          >
            <User size={15} aria-hidden="true" />
            {t.login}
          </button>
        </div>
      </div>
    </header>
  );
}
