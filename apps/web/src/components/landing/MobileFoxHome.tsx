import { useDict } from "../../i18n/LocaleProvider";
import { LocaleSwitcher } from "../../i18n/LocaleSwitcher";
import { ToriiMark } from "./ToriiMark";

const BG_SRC = "/images/landing/shrine-approach.webp";
const FOX_SRC = "/images/landing/fox-welcome.webp";

interface MobileFoxHomeProps {
  onLogin: () => void;
  onStart: () => void;
}

function MobileFoxBrand() {
  const landing = useDict().landing;
  return (<span className="mobile-fox__brand">
    <span className="mobile-fox__badge"><ToriiMark size={22} /></span>
    <span className="mobile-fox__wordmark">{landing.hero}</span>
  </span>);
}

function MobileFoxBar({ onLogin }: { onLogin: () => void }) {
  const landing = useDict().landing;
  // A <div>, not a <header>, so the landing exposes exactly ONE banner
  // landmark (the desktop LandingBar). The mobile bar is a CSS-switched view
  // of the same brand+login affordances, and two banner landmarks on one page
  // is a WCAG 1.3.1 landmark pollution (the desktop bar stays in the DOM and
  // remains the page's banner).
  return (<div className="mobile-fox__bar">
    <MobileFoxBrand />
    <div className="mobile-fox__bar-actions">
      <LocaleSwitcher />
      <button className="landing__login" type="button" onClick={onLogin}>{landing.login}</button>
    </div>
  </div>);
}

function MobileFoxGuide() {
  const landing = useDict().landing;
  return (<div className="mobile-fox__guide">
    <p className="mobile-fox__bubble">{landing.fox_bubble}</p>
    <img className="mobile-fox__fox" src={FOX_SRC} alt={landing.fox_alt} width={190} height={158} />
  </div>);
}

/** Decorative polaroid sticker stack from the mockup scene (aria-hidden). */
function StickerCardMint() {
  return (<g transform="rotate(-9 57 51)">
    <rect x="13" y="13" width="76" height="76" rx="8" fill="var(--color-card)" stroke="var(--color-border)" strokeWidth={3} />
    <rect x="22" y="22" width="58" height="43" rx="4" fill="var(--color-primary-soft)" />
    <path fill="none" stroke="var(--color-primary)" strokeWidth={6} d="M20 65h60" />
    <path fill="var(--color-fg)" d="M26 36h48v7H26zM31 46h38v6H31z" opacity=".45" />
  </g>);
}

function StickerCardGold() {
  return (<g transform="rotate(8 120 51)">
    <rect x="91" y="7" width="76" height="80" rx="8" fill="var(--color-card)" stroke="var(--color-border)" strokeWidth={3} />
    <rect x="100" y="17" width="58" height="47" rx="4" fill="var(--landing-chip-gold)" opacity=".9" />
    <path fill="var(--landing-brand)" d="M117 22h24v8h-24zM121 31h5v25h-5zM134 31h5v25h-5z" />
  </g>);
}

function StickerRibbonRoute() {
  return (<>
    <path fill="var(--landing-chip-gold)" stroke="var(--color-border)" strokeWidth={3} d="M74 88c26-18 42-15 75-4-22 15-45 20-75 4z" />
    <path fill="none" stroke="var(--color-primary)" strokeLinecap="round" strokeWidth={5} d="M48 100c28-22 55-22 86 0" />
  </>);
}

function MobileFoxStickers() {
  return (<span className="mobile-fox__stickers" aria-hidden="true">
    <svg viewBox="0 0 180 120" width="100%" height="100%" fill="none">
      <StickerCardMint />
      <StickerCardGold />
      <StickerRibbonRoute />
    </svg>
  </span>);
}

/** Route-stamp chip beside the CTA, matching the mockup's settled scene. */
function MobileFoxStamp() {
  return (<span className="mobile-fox__stamp" aria-hidden="true">
    <svg viewBox="0 0 80 64" width="100%" height="100%" fill="none">
      <path fill="var(--color-card)" stroke="var(--color-border)" strokeWidth={3} d="M7 14h48c8 0 14 6 14 14v16c0 8-6 14-14 14H7z" />
      <path fill="none" stroke="var(--color-primary)" strokeLinecap="round" strokeWidth={5} d="M20 40c7-13 16-19 30-22" />
      <path fill="var(--color-primary)" d="M54 14l12 5-10 8z" />
    </svg>
  </span>);
}

function MobileFoxActions({ onStart }: { onStart: () => void }) {
  const landing = useDict().landing;
  return (<div className="mobile-fox__actions">
    <button className="mobile-fox__cta" type="button" onClick={onStart}>{landing.cta}</button>
    <MobileFoxStamp />
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

function MobileFoxScene() {
  return (<div className="mobile-fox__scene">
    <MobileFoxGuide />
    <MobileFoxStickers />
  </div>);
}

/** Mobile-only fox welcome hero: shrine-approach art, fox guide, serif title, gold CTA.
    Always server-rendered; visibility is CSS-only (see landing.css) to avoid hydration drift. */
export function MobileFoxHome({ onLogin, onStart }: MobileFoxHomeProps) {
  const landing = useDict().landing;
  return (<section className="mobile-fox" aria-labelledby="mobile-fox-title">
    <img className="mobile-fox__bg" src={BG_SRC} alt={landing.mobile_bg_alt} width={941} height={1672} />
    <MobileFoxBar onLogin={onLogin} />
    <MobileFoxScene />
    <MobileFoxCopy onStart={onStart} />
  </section>);
}
