import type { ReactElement } from "react";

const SPLASH_FRAMES: ReactElement = (
  <>
    <div className="app-splash__frame phone day">
      <SplashStatusBar time="9:41" />
      <SplashMiddle icon="/splash-day.svg" />
      <SplashFooter />
    </div>
    <div className="app-splash__frame phone night">
      <SplashStatusBar time="21:07" />
      <SplashMiddle icon="/splash-night.svg" />
      <SplashFooter />
    </div>
  </>
);

function SplashStatusBar({ time }: { time: string }): ReactElement {
  return (
    <div className="app-splash__status">
      <span>{time}</span>
      <span className="app-splash__dots">●●●</span>
    </div>
  );
}

function SplashMiddle({ icon }: { icon: string }): ReactElement {
  return (
    <div className="app-splash__middle">
      <img src={icon} width="92" height="92" alt="" />
      <span className="app-splash__wordmark">ANIMICHI</span>
      <strong>聖地巡礼</strong>
      <span className="app-splash__tagline">あの画面に、行こう。</span>
    </div>
  );
}

function SplashFooter(): ReactElement {
  return (
    <div className="app-splash__footer">
      <img src="/images/splash/fox-stand.webp" width="72" height="72" alt="" />
      <span className="app-splash__ground" />
      <small>画像・座標:Anitabi (CC BY-NC-SA 4.0)</small>
      <span className="app-splash__bar" />
    </div>
  );
}

/** Static, system-themed splash; dismissal is driven by CSS, never a JS timer.
 * `hold` marks the index route — the doorway that hands off to chat — where CSS
 * keeps the splash up at every viewport until chat paints and releases it, so
 * the landing underneath is never flashed
 * (owner 2026-08-23; see features/splash/splash-release.ts). */
export function Splash({ hold = false }: { readonly hold?: boolean }): ReactElement {
  return (
    <div className="app-splash" data-splash="static" data-splash-hold={hold ? "handoff" : undefined} aria-hidden="true">
      {SPLASH_FRAMES}
    </div>
  );
}
