import { useCallback, useState } from "react";
import type { Dict } from "../../i18n/dictionaries";
import { useDict } from "../../i18n/context";
import { LocaleSwitcher } from "../../i18n/LocaleSwitcher";
import { LoginModal } from "../auth/LoginModal";
import { DayNightToggle } from "./DayNightToggle";
import { Hero } from "./Hero";
import { MobileFoxHome } from "./MobileFoxHome";
import { ToriiMark } from "./ToriiMark";

const REPO_URL = "https://github.com/lifeodyssey/animichi";

interface AuthModal {
  open: boolean;
  openAuth: () => void;
  closeAuth: () => void;
}

function useAuthModal(): AuthModal {
  const [open, setOpen] = useState(false);
  const openAuth = useCallback(() => { setOpen(true); }, []);
  const closeAuth = useCallback(() => { setOpen(false); }, []);
  return { open, openAuth, closeAuth };
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
  const { open, openAuth, closeAuth } = useAuthModal();
  return (<main className="landing">
    <LandingBar onLogin={openAuth} />
    <Hero onStart={openAuth} />
    <MobileFoxHome onLogin={openAuth} onStart={openAuth} />
    <LandingFooter />
    <LoginModal open={open} onClose={closeAuth} />
  </main>);
}
