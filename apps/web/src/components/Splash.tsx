import type { ReactElement } from "react";

const SPLASH_MARKUP: ReactElement = (
  <div className="app-splash" data-splash="static" aria-hidden="true">
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
  </div>
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
      <small>アニメの舞台を、歩きに行こう。</small>
      <span className="app-splash__bar" />
    </div>
  );
}

/** Static, system-themed splash; dismissal is driven by CSS, never a JS timer. */
export function Splash(): ReactElement {
  return SPLASH_MARKUP;
}
