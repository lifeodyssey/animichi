import { useMemo, useState } from "react";
import type { Dict } from "../../i18n/dictionaries";
import { useDict } from "../../i18n/context";
import { LocaleSwitcher } from "../../i18n/LocaleSwitcher";
import { isShowcase } from "../../features/config/showcase";
import { LoginModal } from "../auth/LoginModal";
import { chatSearchPath } from "../home/search-target";
import { ComingSoonPopup } from "./ComingSoonPopup";
import { DayNightToggle } from "./DayNightToggle";
import { Hero } from "./Hero";
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

function BarActions({ onLogin }: { onLogin: () => void }) {
  const landing = useDict().landing;
  return (
    <div className="landing__bar-actions">
      <LocaleSwitcher />
      <DayNightToggle />
      <button className="landing__login" type="button" onClick={onLogin}>{landing.login}</button>
    </div>
  );
}

function LandingBar({ onLogin }: { onLogin: () => void }) {
  const landing = useDict().landing;
  return (
    <header className="landing__bar">
      <span className="landing__wordmark"><ToriiMark size={24} />{landing.hero}</span>
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

/** Marketing landing: journal-card hero on desktop, fox welcome on mobile (CSS-switched). */
export function LandingPage() {
  const entry = useEntryPoint();
  return <main className="landing">
    <LandingBar onLogin={entry.openPlain} />
    <Hero onStart={entry.openSearch} />
    <MobileFoxHome onLogin={entry.openPlain} onStart={entry.openPlain} />
    <LandingFooter />
    <EntryGate entry={entry} />
  </main>;
}
