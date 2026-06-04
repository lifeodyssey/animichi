"use client";

import { useLocale } from "../../lib/i18n-context";
import SharedFooter from "../layout/SharedFooter";
import LandingHeader from "./LandingHeader";
import LandingHero from "./LandingHero";

interface LandingPageProps {
  onOpenAuth: (query?: string) => void;
}

/**
 * LandingPage — currently the HERO screen only. The lower sections (how-it-works,
 * popular routes, save-sync) were removed pending a redesign; they will be rebuilt
 * later. Keep this composition minimal until then.
 */
export default function LandingPage({ onOpenAuth }: LandingPageProps) {
  const locale = useLocale();

  return (
    <div id="top" className="overflow-x-hidden bg-[var(--animal-bg-color-content)] font-sans" lang={locale}>
      <LandingHeader onLogin={onOpenAuth} />

      {/* ═══════ HERO (the only section for now) ═══════ */}
      <LandingHero onOpenAuth={onOpenAuth} />

      <SharedFooter />
    </div>
  );
}
