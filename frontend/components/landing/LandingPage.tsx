"use client";

import { useLocale } from "../../lib/i18n-context";
import LandingHeader from "../auth/LandingHeader";
import SharedFooter from "../layout/SharedFooter";
import Hero from "./Hero";

interface LandingPageProps {
  onOpenAuth: (query?: string) => void;
}

/**
 * LandingPage — the hero screen, composed of the kept pill header (redraw
 * elements 1-3), the rebuilt hero band (4-15), and the shared footer bar (16).
 * The lower sections (how-it-works, popular routes, save-sync) were removed
 * pending a redesign.
 */
export default function LandingPage({ onOpenAuth }: LandingPageProps) {
  const locale = useLocale();

  return (
    <div id="top" className="flex min-h-[100svh] flex-col overflow-x-hidden bg-background font-sans" lang={locale}>
      <LandingHeader onLogin={onOpenAuth} />
      <Hero onOpenAuth={onOpenAuth} />
      <SharedFooter />
    </div>
  );
}
