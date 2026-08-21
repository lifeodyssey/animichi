import { useMemo, useState } from "react";
import type { Dict } from "../../i18n/dictionaries";
import { useDict } from "../../i18n/LocaleProvider";
import { LocaleSwitcher } from "../../i18n/LocaleSwitcher";
import { isShowcase } from "../../features/config/showcase";
import { LoginModal } from "../../features/auth/ui/LoginModal";
import { chatSearchPath } from "../home/search-target";
import { ComingSoonPopup } from "./ComingSoonPopup";
import { DayNightToggle } from "./DayNightToggle";
import { Hero } from "./Hero";
import { LandingDeco } from "./LandingDeco";
import { MobileFoxHome } from "./MobileFoxHome";
import { ToriiMark } from "./ToriiMark";

const REPO_URL = "https://github.com/lifeodyssey/animichi";

interface SearchLoginState {
  open: boolean;
  returnTarget: string | undefined;
  openSearch: (query: string) => void;
  openPlain: () => void;
  closeAuth: () => void;
}

/** Login-modal state plus the query-preserving return target: the hero search
 * carries `/chat?q=…` (journey §1-A②), plain logins deliberately carry none. */
function useSearchLogin(): SearchLoginState {
  const [open, setOpen] = useState(false);
  const [returnTarget, setReturnTarget] = useState<string | undefined>(undefined);
  const openSearch = (query: string) => { setReturnTarget(chatSearchPath(query)); setOpen(true); };
  const openPlain = () => { setReturnTarget(undefined); setOpen(true); };
  const closeAuth = () => { setOpen(false); };
  return { open, returnTarget, openSearch, openPlain, closeAuth };
}

interface PopupState {
  open: boolean;
  openAuth: () => void;
  closeAuth: () => void;
}

function usePopup(): PopupState {
  const [open, setOpen] = useState(false);
  return { open, openAuth: () => { setOpen(true); }, closeAuth: () => { setOpen(false); } };
}

interface EntryPoint {
  showcase: boolean;
  openSearch: (query: string) => void;
  openPlain: () => void;
  login: SearchLoginState;
  popup: PopupState;
}

/**
 * Showcase interception wraps each entry point's ORIGINAL action: showcase mode
 * opens the ComingSoonPopup; otherwise the action runs with its arguments intact
 * (so a future search entry keeps its query — the #795 merge shape).
 */
function makeGuard(showcase: boolean, openPopup: () => void) {
  return <A extends unknown[]>(action: (...args: A) => void) =>
    (...args: A) => {
      if (showcase) { openPopup(); return; }
      action(...args);
    };
}

function useEntryPoint(): EntryPoint {
  const showcase = isShowcase();
  const login = useSearchLogin();
  const popup = usePopup();
  const guard = useMemo(() => makeGuard(showcase, popup.openAuth), [showcase, popup.openAuth]);
  return { showcase, openSearch: guard(login.openSearch), openPlain: guard(login.openPlain), login, popup };
}

function EntryGate({ entry }: { entry: EntryPoint }) {
  if (entry.showcase) return <ComingSoonPopup open={entry.popup.open} onClose={entry.popup.closeAuth} />;
  return <LoginModal open={entry.login.open} onClose={entry.login.closeAuth} returnTarget={entry.login.returnTarget} />;
}

function LoginIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21a7 7 0 0 1 14 0" />
    </svg>
  );
}

function BarActions({ onLogin }: { onLogin: () => void }) {
  const landing = useDict().landing;
  return (
    <div className="landing__bar-actions">
      <LocaleSwitcher />
      <button className="landing__login" type="button" onClick={onLogin}><LoginIcon />{landing.login}</button>
    </div>
  );
}

function BrandMark() {
  return (
    <span className="landing__brand-mark">
      <img className="landing__brand-torii" src="/images/landing/torii.svg" alt="" width={50} height={50} />
      <img className="landing__brand-fox" src="/images/landing/fox/fox-curious.svg" alt="" width={32} height={32} />
    </span>
  );
}

/** Two-tone lettering: plain ink first half, teal-block accent second half. */
function LandingWordmark() {
  const landing = useDict().landing;
  return (
    <span className="landing__wordmark">
      <span className="landing__wordmark-pre">{landing.brand_pre}</span>
      <span className="landing__wordmark-accent">{landing.brand_accent}</span>
    </span>
  );
}

/** Brand lockup: the torii/fox emblem beside the wordmark. */
function LandingBrand() {
  return (
    <span className="landing__brand">
      <BrandMark />
      <LandingWordmark />
    </span>
  );
}

function LandingBar({ onLogin }: { onLogin: () => void }) {
  return (
    <header className="landing__bar">
      <LandingBrand />
      <BarActions onLogin={onLogin} />
    </header>
  );
}

function FooterLinks({ landing }: { landing: Dict["landing"] }) {
  return <nav className="landing__footer-links" aria-label={landing.footer_nav}>
    <a className="landing__footer-link" href="/privacy">{landing.privacy}</a>
    <a className="landing__footer-link" href={REPO_URL} target="_blank" rel="noreferrer">{landing.github}</a>
  </nav>;
}

function LandingFooter() {
  const landing = useDict().landing;
  return (
    <footer className="landing__footer">
      <span className="landing__footer-brand"><ToriiMark size={16} />{landing.hero}<span className="landing__footer-name">{landing.footer_name}</span></span>
      <FooterLinks landing={landing} />
    </footer>
  );
}

/** The wide-viewport landing surface: decor, nav bar, hero and footer. */
function DesktopLanding({ entry }: { entry: EntryPoint }) {
  return (
    <div className="landing__page">
      <LandingDeco />
      <LandingBar onLogin={entry.openPlain} />
      <Hero onStart={entry.openSearch} />
      <LandingFooter />
    </div>
  );
}

/** Marketing landing: journal-card hero on desktop, fox welcome on mobile (CSS-switched). */
export function LandingPage() {
  const entry = useEntryPoint();
  return <main className="landing">
    <DesktopLanding entry={entry} />
    <MobileFoxHome onLogin={entry.openPlain} onStart={entry.openPlain} />
    <DayNightToggle />
    <EntryGate entry={entry} />
  </main>;
}
