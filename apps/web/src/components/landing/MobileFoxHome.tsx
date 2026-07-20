import { useDict } from "../../i18n/context";
import { LocaleSwitcher } from "../../i18n/LocaleSwitcher";
import { ToriiMark } from "./ToriiMark";

const BG_SRC = "/images/landing/shrine-approach.webp";
const FOX_SRC = "/images/landing/fox-welcome.webp";

interface MobileFoxHomeProps {
  onLogin: () => void;
  onStart: () => void;
}

function MobileFoxBar({ onLogin }: { onLogin: () => void }) {
  const landing = useDict().landing;
  return (<header className="mobile-fox__bar">
    <span className="mobile-fox__badge"><ToriiMark size={22} /></span>
    <div className="mobile-fox__bar-actions">
      <LocaleSwitcher />
      <button className="landing__login" type="button" onClick={onLogin}>{landing.login}</button>
    </div>
  </header>);
}

function MobileFoxGuide() {
  const landing = useDict().landing;
  return (<div className="mobile-fox__guide">
    <p className="mobile-fox__bubble">{landing.fox_bubble}</p>
    <img className="mobile-fox__fox" src={FOX_SRC} alt={landing.fox_alt} width={190} height={158} />
  </div>);
}

function MobileFoxMapChip() {
  return (<span className="mobile-fox__map" aria-hidden="true">
    <svg viewBox="0 0 32 32" width={26} height={26} fill="none">
      <path d="M6 25c6-2 3-12 9-12s3 9 11-5" stroke="var(--color-primary)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={6} cy={25} r={3.2} fill="var(--landing-brand)" />
    </svg>
  </span>);
}

function MobileFoxActions({ onStart }: { onStart: () => void }) {
  const landing = useDict().landing;
  return (<div className="mobile-fox__actions">
    <button className="mobile-fox__cta" type="button" onClick={onStart}>{landing.cta}</button>
    <MobileFoxMapChip />
  </div>);
}

function MobileFoxCopy({ onStart }: { onStart: () => void }) {
  const landing = useDict().landing;
  return (<div className="mobile-fox__copy">
    <p className="mobile-fox__lead">{landing.mobile_lead}</p>
    <h2 id="mobile-fox-title" className="mobile-fox__title">{landing.hero}</h2>
    <MobileFoxActions onStart={onStart} />
  </div>);
}

/** Mobile-only fox welcome hero: shrine-approach art, fox guide, serif title, gold CTA.
    Always server-rendered; visibility is CSS-only (see landing.css) to avoid hydration drift. */
export function MobileFoxHome({ onLogin, onStart }: MobileFoxHomeProps) {
  const landing = useDict().landing;
  return (<section className="mobile-fox" aria-labelledby="mobile-fox-title">
    <img className="mobile-fox__bg" src={BG_SRC} alt={landing.mobile_bg_alt} width={941} height={1672} />
    <MobileFoxBar onLogin={onLogin} />
    <div className="mobile-fox__scene"><MobileFoxGuide /></div>
    <MobileFoxCopy onStart={onStart} />
  </section>);
}
