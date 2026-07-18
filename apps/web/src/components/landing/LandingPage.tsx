import { useCallback, useState } from "react";
import { useDict } from "../../i18n/context";
import { LocaleSwitcher } from "../../i18n/LocaleSwitcher";
import { LoginModal } from "../auth/LoginModal";
import { DayNightToggle } from "./DayNightToggle";
import { Hero } from "./Hero";

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
      <button className="ds-button" type="button" onClick={onLogin}>{landing.login}</button>
    </div>
  );
}

function LandingBar({ onLogin }: { onLogin: () => void }) {
  const landing = useDict().landing;
  return (
    <header className="landing__bar">
      <span className="landing__wordmark">{landing.hero}</span>
      <BarActions onLogin={onLogin} />
    </header>
  );
}

/** Marketing landing: header controls, hero + comparison slider, login modal. */
export function LandingPage() {
  const { open, openAuth, closeAuth } = useAuthModal();
  return (
    <main className="landing">
      <LandingBar onLogin={openAuth} />
      <Hero onStart={openAuth} />
      <LoginModal open={open} onClose={closeAuth} />
    </main>
  );
}
