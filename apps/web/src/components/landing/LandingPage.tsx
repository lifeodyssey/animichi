import { useState } from "react";
import type { Dict } from "../../i18n/dictionaries";
import { useDict } from "../../i18n/context";
import { LocaleSwitcher } from "../../i18n/LocaleSwitcher";
import { LoginModal } from "../auth/LoginModal";
import { chatSearchPath } from "../home/search-target";
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
  const { open, returnTarget, openSearch, openPlain, closeAuth } = useSearchLogin();
  return (<main className="landing">
    <LandingBar onLogin={openPlain} />
    <Hero onStart={openSearch} />
    <MobileFoxHome onLogin={openPlain} onStart={openPlain} />
    <LandingFooter />
    <LoginModal open={open} onClose={closeAuth} returnTarget={returnTarget} />
  </main>);
}
